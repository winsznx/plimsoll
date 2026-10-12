import { sql } from "drizzle-orm";
import { isChainConfigured } from "./chain";
import { db, ensureMigrated } from "./db/client";
import { claimJob, completeJob, enqueue, failJob, type JobRow, type JobType } from "./jobs";
import { ensureSeeded, seedSampleChain } from "./seed";
import { analyzeVersion } from "./services/documents";
import { pollCarriers, type CarrierPollReport } from "./services/carriers";
import { extendIdleEscrows } from "./services/maintenance";
import { deliverWebhook } from "./services/notify";
import { explainDealFindings, reconcileDeal } from "./services/reconcile";
import { indexerTick, syncDeal } from "./services/sync";

type Handler = (payload: Record<string, unknown>, deadline: number) => Promise<unknown>;

const HANDLERS: Record<JobType, Handler> = {
  analyze_document: (p) => analyzeVersion(String(p.versionId)),
  reconcile_deal: (p) => reconcileDeal(String(p.dealId)),
  explain_findings: (p) => explainDealFindings(String(p.dealId)),
  sync_deal: async (p) => {
    const r = await syncDeal(String(p.dealId));
    if (r.status === "unavailable") throw new Error("RPC unavailable; will retry");
  },
  deliver_webhook: (p) => deliverWebhook(String(p.deliveryId)),
  seed_sample_chain: async (_p, deadline) => {
    // A lease, not a job dedupe key, keeps two runners from seeding the same scenario twice.
    if (!(await claim("seedLease", 120_000))) return;
    try {
      const done = await seedSampleChain(deadline);
      if (!done) await enqueue(db(), "seed_sample_chain", { resumed: true }, { dedupeKey: "seed_sample_chain:resume" });
    } finally {
      await release("seedLease");
    }
  },
};

const PERIODIC = {
  indexer: 10_000,
  ttl: 6 * 60 * 60 * 1000,
  seedCheck: 5 * 60 * 1000,
  carriers: 5 * 60 * 1000,
} as const;

/** Claims a named slot atomically; false if another runner claimed it within `intervalMs`. */
async function claim(name: string, intervalMs: number): Promise<boolean> {
  const res = await db().execute<{ name: string }>(sql`
    insert into plimsoll.scheduler_state (name, last_run_at) values (${name}, now())
    on conflict (name) do update set last_run_at = now()
    where plimsoll.scheduler_state.last_run_at < now() - (${intervalMs} * interval '1 millisecond')
    returning name`);
  return res.rows.length > 0;
}

async function release(name: string): Promise<void> {
  await db().execute(sql`update plimsoll.scheduler_state set last_run_at = 'epoch' where name = ${name}`);
}

function due(name: keyof typeof PERIODIC): Promise<boolean> {
  return claim(name, PERIODIC[name]);
}

async function runJob(job: JobRow, deadline: number): Promise<void> {
  try {
    await HANDLERS[job.type as JobType](job.payload, deadline);
    await completeJob(job.id);
  } catch (e) {
    console.error(`[worker] ${job.type} failed (attempt ${job.attempts})`, e instanceof Error ? e.message : e);
    await failJob(job, e);
  }
}

export interface TickReport {
  jobs: number;
  indexed: number | null;
  ttl: { extended: number; failed: number } | null;
  carriers: CarrierPollReport | null;
  ms: number;
}

/**
 * One bounded slice of background work: queued jobs, the ledger event indexer, TTL upkeep and
 * attached carrier feeds.
 * The local dev loop calls it continuously; serverless hosts call it from a cron-triggered
 * endpoint. A job that starts near the deadline may overrun it, so callers leave headroom.
 */
export async function runTick(budgetMs: number): Promise<TickReport> {
  const started = Date.now();
  const deadline = started + budgetMs;
  await ensureMigrated();
  const report: TickReport = { jobs: 0, indexed: null, ttl: null, carriers: null, ms: 0 };

  if (await due("seedCheck")) await ensureSeeded().catch((e: unknown) => console.error("[worker] seeding check failed", e));

  while (Date.now() < deadline) {
    const job = await claimJob();
    if (!job) break;
    await runJob(job, deadline);
    report.jobs++;
  }

  if (isChainConfigured() && Date.now() < deadline && (await due("indexer"))) {
    const r = await indexerTick().catch((e: unknown) => {
      console.error("[indexer]", e instanceof Error ? e.message : e);
      return null;
    });
    report.indexed = r?.events ?? null;
  }
  if (isChainConfigured() && Date.now() < deadline && (await due("ttl"))) {
    report.ttl = await extendIdleEscrows().catch((e: unknown) => {
      console.error("[ttl]", e instanceof Error ? e.message : e);
      return null;
    });
  }
  if (Date.now() < deadline && (await due("carriers"))) {
    report.carriers = await pollCarriers().catch((e: unknown) => {
      console.error("[carriers]", e instanceof Error ? e.message : e);
      return null;
    });
  }
  report.ms = Date.now() - started;
  return report;
}

const globalForWorker = globalThis as unknown as { plimsollWorker?: { stop: () => void } };

/** Continuous in-process loop for single-node and local deployments. */
export function startWorker(): void {
  if (globalForWorker.plimsollWorker) return;
  let stopped = false;
  const loop = async () => {
    while (!stopped) {
      try {
        const r = await runTick(15_000);
        if (r.jobs === 0) await new Promise((res) => setTimeout(res, 1_000));
      } catch (e) {
        console.error("[worker] tick failed", e);
        await new Promise((res) => setTimeout(res, 5_000));
      }
    }
  };
  void loop();
  globalForWorker.plimsollWorker = { stop: () => (stopped = true) };
  console.log("[worker] started");
}
