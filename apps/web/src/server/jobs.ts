import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "./db/client";

export type JobType = "analyze_document" | "reconcile_deal" | "explain_findings" | "sync_deal" | "deliver_webhook" | "seed_sample_chain";

export async function enqueue(
  conn: Db | Tx,
  type: JobType,
  payload: Record<string, unknown>,
  opts: { dedupeKey?: string; delayMs?: number } = {},
): Promise<void> {
  await conn
    .insert(schema.jobs)
    .values({ type, payload, dedupeKey: opts.dedupeKey ?? null, runAt: new Date(Date.now() + (opts.delayMs ?? 0)), maxAttempts: RETRY_POLICY[type]?.maxAttempts ?? 8 })
    .onConflictDoNothing({ target: schema.jobs.dedupeKey });
}

export type JobRow = typeof schema.jobs.$inferSelect;

/**
 * Backoff doubles from one minute up to the cap. Webhooks retry for about 24 hours
 * (1+2+…+64 minutes, then 11 two-hour waits) before parking for operator review.
 */
const RETRY_POLICY: Partial<Record<JobType, { maxAttempts: number; capMs: number }>> = {
  deliver_webhook: { maxAttempts: 19, capMs: 2 * 60 * 60_000 },
};
const DEFAULT_CAP_MS = 30 * 60_000;

const LOCK_TIMEOUT_MS = 5 * 60 * 1000;

/** Claims one ready job with SKIP LOCKED so several workers can share the table safely. */
export async function claimJob(): Promise<JobRow | null> {
  const rows = await db().execute<{ id: string }>(sql`
    update plimsoll.jobs set locked_at = now(), attempts = attempts + 1
    where id = (
      select id from plimsoll.jobs
      where done_at is null and dead_at is null and run_at <= now()
        and (locked_at is null or locked_at < now() - (${LOCK_TIMEOUT_MS} * interval '1 millisecond'))
      order by run_at
      for update skip locked
      limit 1
    )
    returning id`);
  const id = rows.rows[0]?.id;
  if (!id) return null;
  const [job] = await db().select().from(schema.jobs).where(eq(schema.jobs.id, id));
  return job ?? null;
}

export async function completeJob(id: string): Promise<void> {
  await db().update(schema.jobs).set({ doneAt: new Date(), lockedAt: null, dedupeKey: null }).where(eq(schema.jobs.id, id));
}

/** Exponential backoff; after maxAttempts the job is parked as dead for operator review. */
export async function failJob(job: JobRow, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const dead = job.attempts >= job.maxAttempts;
  const delay = Math.min(60_000 * 2 ** (job.attempts - 1), RETRY_POLICY[job.type as JobType]?.capMs ?? DEFAULT_CAP_MS);
  await db()
    .update(schema.jobs)
    .set({
      lockedAt: null,
      lastError: message.slice(0, 2000),
      runAt: new Date(Date.now() + delay),
      deadAt: dead ? new Date() : null,
      dedupeKey: dead ? null : job.dedupeKey,
    })
    .where(eq(schema.jobs.id, job.id));
}

export async function pendingJobCount(type?: JobType): Promise<number> {
  const where = type ? and(isNull(schema.jobs.doneAt), isNull(schema.jobs.deadAt), eq(schema.jobs.type, type)) : and(isNull(schema.jobs.doneAt), isNull(schema.jobs.deadAt));
  const [row] = await db().select({ n: sql<number>`count(*)::int` }).from(schema.jobs).where(where);
  return row?.n ?? 0;
}

export async function deadJobs(): Promise<JobRow[]> {
  return db().select().from(schema.jobs).where(and(lte(schema.jobs.runAt, new Date()), sql`dead_at is not null`)).limit(50);
}
