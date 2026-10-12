import { createHash } from "node:crypto";
import { desc, sql } from "drizzle-orm";
import { canonicalJson, type Canonical } from "@plimsoll/domain";
import { db, schema, type Tx } from "./db/client";

export interface AuditInput {
  orgId?: string | null;
  dealId?: string | null;
  actorUserId?: string | null;
  actorLabel: string;
  resourceType: string;
  resourceId: string;
  action: string;
  outcome?: "success" | "denied" | "failed";
  source?: "app" | "chain" | "system";
  evidence?: Record<string, unknown>;
}

const GENESIS = "0".repeat(64);
const AUDIT_LOCK = 0x504c494d;

/**
 * Appends to the hash-chained audit log. A transaction-scoped advisory lock serializes writers
 * so every row links to exactly one predecessor.
 */
export async function appendAudit(tx: Tx, input: AuditInput): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${AUDIT_LOCK})`);
  const [prev] = await tx.select({ hash: schema.auditEvents.hash }).from(schema.auditEvents).orderBy(desc(schema.auditEvents.seq)).limit(1);
  const prevHash = prev?.hash ?? GENESIS;
  const createdAt = new Date();
  const record = {
    orgId: input.orgId ?? null,
    dealId: input.dealId ?? null,
    actorUserId: input.actorUserId ?? null,
    actorLabel: input.actorLabel,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    action: input.action,
    outcome: input.outcome ?? "success",
    source: input.source ?? "app",
    evidence: input.evidence ?? {},
  };
  const hash = createHash("sha256")
    .update(prevHash)
    .update(canonicalJson({ ...record, createdAt: createdAt.toISOString() } as unknown as Canonical))
    .digest("hex");
  await tx.insert(schema.auditEvents).values({ ...record, prevHash, hash, createdAt });
}

export async function audit(input: AuditInput): Promise<void> {
  await db().transaction((tx) => appendAudit(tx, input));
}

/** Recomputes the chain; returns the first broken sequence number, or null if intact. */
export async function verifyAuditChain(): Promise<{ checked: number; brokenAt: number | null }> {
  const rows = await db().select().from(schema.auditEvents).orderBy(schema.auditEvents.seq);
  let prevHash = GENESIS;
  for (const r of rows) {
    const record = {
      orgId: r.orgId,
      dealId: r.dealId,
      actorUserId: r.actorUserId,
      actorLabel: r.actorLabel,
      resourceType: r.resourceType,
      resourceId: r.resourceId,
      action: r.action,
      outcome: r.outcome,
      source: r.source,
      evidence: r.evidence,
      createdAt: r.createdAt.toISOString(),
    };
    const expected = createHash("sha256").update(prevHash).update(canonicalJson(record as unknown as Canonical)).digest("hex");
    if (r.prevHash !== prevHash || r.hash !== expected) return { checked: rows.length, brokenAt: r.seq };
    prevHash = r.hash;
  }
  return { checked: rows.length, brokenAt: null };
}
