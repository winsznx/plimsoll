import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { formatAmount, type ChainSnapshot } from "@plimsoll/domain";
import { isRpcUnavailable } from "@plimsoll/stellar";
import { appendAudit } from "../audit";
import { gateway, network } from "../chain";
import { db, schema } from "../db/client";
import type { DealStatus } from "../db/schema";
import { enqueue } from "../jobs";
import { emitWebhook, notifyParticipants } from "./notify";
import { loadSnapshot, storeSnapshot } from "./snapshot";

const STATUS_MAP: Record<ChainSnapshot["agreement"]["status"], DealStatus> = {
  AwaitingAcceptance: "awaiting_acceptance",
  AwaitingFunding: "awaiting_funding",
  Funded: "funded",
  Completed: "completed",
  Cancelled: "cancelled",
};

export type SyncOutcome = { status: "ok"; ledger: number } | { status: "unavailable" } | { status: "no_contract" };

/**
 * Reads authoritative escrow state from the ledger and reconciles every derived table with it.
 * Money state in the UI only ever comes from here.
 */
export async function syncDeal(dealId: string): Promise<SyncOutcome> {
  const [deal] = await db().select().from(schema.deals).where(eq(schema.deals.id, dealId));
  if (!deal?.escrowContractId) return { status: "no_contract" };

  await reconcilePendingTransactions(dealId);

  let snap: ChainSnapshot;
  try {
    snap = await gateway().readSnapshot(deal.escrowContractId, { code: deal.terms.asset.code, issuer: deal.terms.asset.issuer });
  } catch (e) {
    if (isRpcUnavailable(e)) {
      await db().update(schema.deals).set({ chainSyncStatus: "unavailable" }).where(eq(schema.deals.id, dealId));
      return { status: "unavailable" };
    }
    throw e;
  }

  const prev = deal.chainSnapshot ? loadSnapshot(deal.chainSnapshot) : null;
  const status = STATUS_MAP[snap.agreement.status];

  await db().transaction(async (tx) => {
    await tx
      .update(schema.deals)
      .set({ chainSnapshot: storeSnapshot(snap), chainSyncedLedger: snap.ledger, chainSyncedAt: new Date(), chainSyncStatus: "ok", status, updatedAt: prev && status !== deal.status ? new Date() : deal.updatedAt })
      .where(eq(schema.deals.id, dealId));

    const bundles = await tx.select().from(schema.evidenceBundles).where(eq(schema.evidenceBundles.dealId, dealId));
    for (const m of snap.milestones) {
      for (const b of bundles.filter((x) => x.milestoneOrdinal === m.id)) {
        const next = b.digest === m.evidenceDigest ? "anchored" : b.status === "anchored" ? "superseded" : b.status;
        if (next !== b.status) await tx.update(schema.evidenceBundles).set({ status: next }).where(eq(schema.evidenceBundles.id, b.id));
      }
      const disputeStatus = m.status === "Disputed" ? "open" : m.status === "Resolved" ? "resolved" : null;
      if (disputeStatus) {
        await tx
          .update(schema.disputes)
          .set({ status: disputeStatus, resolvedAt: disputeStatus === "resolved" ? new Date() : null })
          .where(and(eq(schema.disputes.dealId, dealId), eq(schema.disputes.milestoneOrdinal, m.id), inArray(schema.disputes.status, disputeStatus === "open" ? ["opening"] : ["opening", "open"])));
      }
    }

    if (prev) {
      for (const change of describeChanges(prev, snap)) {
        await appendAudit(tx, { dealId, actorLabel: "Stellar ledger", resourceType: "escrow", resourceId: deal.escrowContractId!, action: change.action, source: "chain", evidence: { ledger: snap.ledger, ...change.evidence } });
      }
    }
  });

  if (prev) await announceChanges(dealId, deal.reference, prev, snap);
  return { status: "ok", ledger: snap.ledger };
}

interface Change {
  action: string;
  evidence: Record<string, string | number>;
  webhook?: Parameters<typeof emitWebhook>[1];
  title?: string;
}

function describeChanges(prev: ChainSnapshot, next: ChainSnapshot): Change[] {
  const out: Change[] = [];
  const a0 = prev.agreement;
  const a1 = next.agreement;
  if (!(a0.buyerAccepted && a0.supplierAccepted) && a1.buyerAccepted && a1.supplierAccepted) out.push({ action: "escrow.terms_accepted", evidence: { termsDigest: a1.termsDigest }, webhook: "deal.accepted", title: "Both parties accepted the terms on-chain" });
  if (a1.funded > a0.funded) out.push({ action: "escrow.funded", evidence: { fundedUnits: String(a1.funded), totalUnits: String(a1.total) }, webhook: a1.funded === a1.total ? "escrow.funded.confirmed" : undefined, title: `Escrow funded: ${formatAmount(a1.funded)} of ${formatAmount(a1.total)}` });
  for (const m1 of next.milestones) {
    const m0 = prev.milestones.find((m) => m.id === m1.id);
    if (!m0) continue;
    if (m1.evidenceDigest !== m0.evidenceDigest && m1.evidenceDigest) out.push({ action: "escrow.evidence_anchored", evidence: { milestone: m1.id, digest: m1.evidenceDigest } });
    const added = m1.approvals.filter((x) => !m0.approvals.includes(x));
    if (added.length > 0) out.push({ action: "escrow.milestone_approved", evidence: { milestone: m1.id, approvals: m1.approvals.length, quorum: m1.quorum }, webhook: "milestone.approval.confirmed", title: `Milestone ${m1.id + 1}: ${m1.approvals.length} of ${m1.quorum} approvals on current evidence` });
    if (m0.status !== m1.status) {
      const map: Record<string, Pick<Change, "action" | "webhook"> & { verb: string }> = {
        Released: { action: "escrow.milestone_released", webhook: "milestone.release.confirmed", verb: "released to payee" },
        Disputed: { action: "escrow.dispute_opened", webhook: "dispute.opened", verb: "frozen by dispute" },
        Resolved: { action: "escrow.dispute_resolved", webhook: "dispute.resolved", verb: "resolved by resolver allocation" },
        Refunded: { action: "escrow.refund_executed", webhook: "refund.confirmed", verb: "refunded to buyer" },
      };
      const c = map[m1.status];
      if (c) out.push({ action: c.action, evidence: { milestone: m1.id, amountUnits: String(m1.amount) }, webhook: c.webhook, title: `Milestone ${m1.id + 1} ${c.verb}: ${formatAmount(m1.amount)}` });
    }
  }
  if (a0.status !== "Completed" && a1.status === "Completed") out.push({ action: "escrow.completed", evidence: { releasedUnits: String(a1.released), refundedUnits: String(a1.refunded) }, title: "Agreement completed; escrow balance is zero" });
  if (a0.status !== "Cancelled" && a1.status === "Cancelled") out.push({ action: "escrow.cancelled", evidence: { refundedUnits: String(a1.refunded) }, title: "Unfunded agreement cancelled on-chain" });
  return out;
}

async function announceChanges(dealId: string, reference: string, prev: ChainSnapshot, next: ChainSnapshot): Promise<void> {
  for (const c of describeChanges(prev, next)) {
    if (c.title) await notifyParticipants(dealId, { kind: c.action, title: `${reference}: ${c.title}`, body: `Confirmed at ledger ${next.ledger}.`, path: `/deals/${dealId}` });
    if (c.webhook) await emitWebhook(dealId, c.webhook, { ledger: next.ledger, ...c.evidence });
  }
}

/** Pending submissions are settled from the ledger, never retried with changed economics. */
async function reconcilePendingTransactions(dealId: string): Promise<void> {
  const pending = await db()
    .select()
    .from(schema.chainTransactions)
    .where(and(eq(schema.chainTransactions.dealId, dealId), eq(schema.chainTransactions.status, "pending"), isNotNull(schema.chainTransactions.txHash)));
  for (const t of pending) {
    const res = await gateway().transactionStatus(t.txHash!);
    if (res.status === "NOT_FOUND") continue;
    await db()
      .update(schema.chainTransactions)
      .set({ status: res.status === "SUCCESS" ? "confirmed" : "failed", ledger: res.ledger, confirmedAt: new Date() })
      .where(eq(schema.chainTransactions.id, t.id));
  }
}

/**
 * Ledger event ingestion across every escrow. Dedupe is by (network, event id); a gap beyond
 * RPC retention falls back to full state readback, which is authoritative anyway.
 */
export async function indexerTick(): Promise<{ events: number; latestLedger: number } | null> {
  const net = network().id;
  const deals = await db().select({ id: schema.deals.id, contractId: schema.deals.escrowContractId }).from(schema.deals).where(isNotNull(schema.deals.escrowContractId));
  if (deals.length === 0) return null;
  const byContract = new Map(deals.map((d) => [d.contractId!, d.id]));
  const [cursor] = await db().select().from(schema.indexerCursors).where(eq(schema.indexerCursors.network, net));
  const gw = gateway();
  const latest = await gw.latestLedger();
  const start = cursor ? cursor.lastLedger + 1 : latest - 2000;
  if (start > latest) return { events: 0, latestLedger: latest };

  const result = await gw.fetchEvents([...byContract.keys()], start);
  if (result.gap) {
    for (const d of deals) await enqueue(db(), "sync_deal", { dealId: d.id }, { dedupeKey: `sync:${d.id}` });
  }

  const touched = new Set<string>();
  if (result.events.length > 0) {
    await db()
      .insert(schema.chainEvents)
      .values(
        result.events.map((e) => ({
          network: net,
          eventId: e.id,
          contractId: e.contractId,
          dealId: byContract.get(e.contractId) ?? null,
          type: e.type,
          milestoneOrdinal: e.milestoneId,
          ledger: e.ledger,
          ledgerClosedAt: new Date(e.ledgerClosedAt),
          txHash: e.txHash,
          data: e.data,
        })),
      )
      .onConflictDoNothing();
    for (const e of result.events) {
      const id = byContract.get(e.contractId);
      if (id) touched.add(id);
    }
  }
  for (const id of touched) await enqueue(db(), "sync_deal", { dealId: id }, { dedupeKey: `sync:${id}` });
  const last = Math.max(result.latestLedger, start - 1);
  await db().insert(schema.indexerCursors).values({ network: net, lastLedger: last }).onConflictDoUpdate({ target: schema.indexerCursors.network, set: { lastLedger: last, updatedAt: new Date() } });
  return { events: result.events.length, latestLedger: last };
}
