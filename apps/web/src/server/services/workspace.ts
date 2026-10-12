import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { formatAmount } from "@plimsoll/domain";
import { explorer } from "../chain";
import { db, schema } from "../db/client";
import type { SessionContext } from "../auth/session";
import type { ActivityItem } from "@/lib/views";
import { visibleDealIds } from "./access";
import { isBlockingOpen } from "./reconcile";
import { loadSnapshot } from "./snapshot";

export interface OverviewData {
  fundsAtWork: string;
  assetCode: string;
  approvalsWaiting: { dealId: string; reference: string; milestone: string }[];
  documentMismatches: { dealId: string; reference: string; count: number }[];
  shipmentsNearingDeadline: { dealId: string; reference: string; detail: string }[];
  disputesOpen: { dealId: string; reference: string; milestone: number }[];
  recentDeals: { id: string; reference: string; title: string; status: string; counterparty: string; total: string; funded: string; escrow: string; nextCondition: string }[];
  recentSettlements: { dealId: string; reference: string; kind: string; amount: string | null; txHash: string | null; at: string; explorerUrl: string | null }[];
  unsyncedDeals: number;
}

export async function overview(session: SessionContext): Promise<OverviewData> {
  const ids = await visibleDealIds(session);
  const deals = ids.length ? await db().select().from(schema.deals).where(inArray(schema.deals.id, ids)).orderBy(desc(schema.deals.updatedAt)) : [];
  const myAddresses = new Set(session.wallets.map((w) => w.address));
  const discrepancies = ids.length ? await db().select().from(schema.discrepancies).where(inArray(schema.discrepancies.dealId, ids)) : [];
  const disputes = ids.length ? await db().select().from(schema.disputes).where(and(inArray(schema.disputes.dealId, ids), inArray(schema.disputes.status, ["opening", "open"]))) : [];
  const settlements = ids.length
    ? await db().select().from(schema.chainTransactions).where(and(inArray(schema.chainTransactions.dealId, ids), inArray(schema.chainTransactions.kind, ["release", "resolve", "refund", "fund"]), eq(schema.chainTransactions.status, "confirmed"))).orderBy(desc(schema.chainTransactions.createdAt)).limit(8)
    : [];

  let escrowTotal = 0n;
  const approvalsWaiting: OverviewData["approvalsWaiting"] = [];
  const recentDeals: OverviewData["recentDeals"] = [];
  const nearing: OverviewData["shipmentsNearingDeadline"] = [];
  const now = Math.floor(Date.now() / 1000);

  for (const d of deals) {
    const snap = d.chainSnapshot ? loadSnapshot(d.chainSnapshot) : null;
    if (snap) escrowTotal += snap.balance;
    let next = d.status === "draft" ? "Submit terms for acceptance" : d.status === "awaiting_acceptance" ? "Both parties accept terms on-chain" : d.status === "awaiting_funding" ? "Buyer funds escrow" : d.status === "completed" ? "Completed" : d.status === "cancelled" ? "Cancelled" : "";
    if (snap && d.status === "funded") {
      const open = snap.milestones.find((m) => m.status === "Open" || m.status === "Disputed");
      if (open) {
        const name = d.terms.milestones[open.id]?.name ?? `Milestone ${open.id + 1}`;
        next = open.status === "Disputed" ? `${name}: disputed` : open.evidenceDigest ? `${name}: ${open.approvals.length}/${open.quorum} approvals` : `${name}: evidence`;
      }
      for (const m of snap.milestones) {
        if (m.status === "Open" && m.evidenceDigest && m.approvers.some((a) => myAddresses.has(a) && !m.approvals.includes(a))) approvalsWaiting.push({ dealId: d.id, reference: d.reference, milestone: d.terms.milestones[m.id]?.name ?? "" });
        if (m.status === "Open" && m.refundAfter > 0 && m.refundAfter - now < 7 * 86_400 && m.refundAfter > now) nearing.push({ dealId: d.id, reference: d.reference, detail: `${d.terms.milestones[m.id]?.name}: refund window opens ${new Date(m.refundAfter * 1000).toISOString().slice(0, 10)}` });
      }
    }
    if (snap && d.status === "awaiting_funding" && snap.agreement.fundingDeadline - now < 3 * 86_400) nearing.push({ dealId: d.id, reference: d.reference, detail: `Funding deadline ${new Date(snap.agreement.fundingDeadline * 1000).toISOString().slice(0, 10)}` });
    const isBuyer = d.buyerOrgId === session.org?.id;
    recentDeals.push({
      id: d.id,
      reference: d.reference,
      title: d.title,
      status: d.status,
      counterparty: isBuyer ? d.terms.supplier.legalName : d.terms.buyer.legalName,
      total: d.terms.totalUnits,
      funded: snap ? String(snap.agreement.funded) : "0",
      escrow: snap ? String(snap.balance) : "0",
      nextCondition: next,
    });
  }

  const mismatchByDeal = new Map<string, number>();
  for (const x of discrepancies.filter(isBlockingOpen)) mismatchByDeal.set(x.dealId, (mismatchByDeal.get(x.dealId) ?? 0) + 1);

  return {
    fundsAtWork: String(escrowTotal),
    assetCode: deals[0]?.terms.asset.code ?? "DEMOUSD",
    approvalsWaiting,
    documentMismatches: [...mismatchByDeal].map(([dealId, count]) => ({ dealId, reference: deals.find((d) => d.id === dealId)?.reference ?? "", count })),
    shipmentsNearingDeadline: nearing,
    disputesOpen: disputes.map((x) => ({ dealId: x.dealId, reference: deals.find((d) => d.id === x.dealId)?.reference ?? "", milestone: x.milestoneOrdinal })),
    recentDeals: recentDeals.slice(0, 8),
    recentSettlements: settlements.map((t) => ({ dealId: t.dealId, reference: deals.find((d) => d.id === t.dealId)?.reference ?? "", kind: t.kind, amount: t.amountUnits === null ? null : String(t.amountUnits), txHash: t.txHash, at: t.createdAt.toISOString(), explorerUrl: t.txHash ? explorer("tx", t.txHash) : null })),
    unsyncedDeals: deals.filter((d) => d.chainSyncStatus === "unavailable").length,
  };
}

const ACTION_TEXT: Record<string, string> = {
  "deal.draft_created": "created the draft agreement",
  "deal.draft_updated": "updated the draft",
  "deal.escrow_deployed": "deployed the escrow contract with fixed terms",
  "deal.amendment_opened": "reopened terms for amendment",
  "document.version_uploaded": "uploaded a document version",
  "document.analysis_completed": "extracted fields with source spans",
  "reconciliation.completed": "re-ran document reconciliation",
  "discrepancy.accepted_as_is": "accepted a finding as-is",
  "discrepancy.non_material": "declared a finding non-material",
  "discrepancy.correction_requested": "requested a corrected document",
  "evidence.bundle_prepared": "prepared an evidence bundle",
  "shipment.event_recorded": "recorded a shipment event",
  "shipment.attested": "attested a shipment event",
  "shipment.carrier_event_imported": "imported a carrier event (context only)",
  "shipment.carrier_feed_attached": "attached a carrier event feed",
  "shipment.carrier_feed_detached": "detached the carrier event feed",
  "escrow.terms_accepted": "confirmed both parties accepted the terms",
  "escrow.funded": "confirmed escrow funding",
  "escrow.evidence_anchored": "confirmed evidence anchored",
  "escrow.milestone_approved": "confirmed a milestone approval",
  "escrow.milestone_released": "confirmed a milestone release",
  "escrow.dispute_opened": "confirmed a dispute freeze",
  "escrow.dispute_resolved": "confirmed a dispute resolution",
  "escrow.refund_executed": "confirmed a refund",
  "escrow.completed": "confirmed the agreement completed",
  "escrow.cancelled": "confirmed cancellation",
  "wallet.linked": "linked a wallet",
  "auth.passkey_registered": "registered a passkey",
};

export function describeAction(action: string, evidence: Record<string, unknown>): string {
  if (ACTION_TEXT[action]) return ACTION_TEXT[action]!;
  const m = /^escrow\.(\w+)\.(submitted|executed|rejected)$/.exec(action);
  if (m) {
    const verb = m[1]!.replaceAll("_", " ");
    if (m[2] === "rejected") return `attempted ${verb}; contract rejected it (${String(evidence.contractError ?? "unknown")})`;
    return `${m[2] === "executed" ? "executed" : "signed and submitted"} ${verb}`;
  }
  return action;
}

export async function activityFeed(session: SessionContext, opts: { dealId?: string; limit?: number } = {}): Promise<ActivityItem[]> {
  const ids = opts.dealId ? [opts.dealId] : await visibleDealIds(session);
  const where = ids.length ? or(inArray(schema.auditEvents.dealId, ids), and(isNull(schema.auditEvents.dealId), eq(schema.auditEvents.actorUserId, session.user.id))) : and(isNull(schema.auditEvents.dealId), eq(schema.auditEvents.actorUserId, session.user.id));
  const rows = await db().select().from(schema.auditEvents).where(where).orderBy(desc(schema.auditEvents.seq)).limit(opts.limit ?? 100);
  const deals = ids.length ? await db().select({ id: schema.deals.id, reference: schema.deals.reference }).from(schema.deals).where(inArray(schema.deals.id, ids)) : [];
  return rows.map((r) => {
    const txHash = typeof r.evidence.txHash === "string" ? r.evidence.txHash : null;
    return {
      id: String(r.seq),
      at: r.createdAt.toISOString(),
      who: r.actorLabel,
      what: describeAction(r.action, r.evidence),
      source: r.source,
      dealId: r.dealId,
      dealReference: deals.find((d) => d.id === r.dealId)?.reference ?? null,
      evidence: r.evidence,
      txHash,
      explorerUrl: txHash ? explorer("tx", txHash) : null,
    };
  });
}

export async function counterpartiesFor(session: SessionContext) {
  const ids = await visibleDealIds(session);
  if (ids.length === 0) return [];
  const parts = await db().select().from(schema.dealParticipants).where(inArray(schema.dealParticipants.dealId, ids));
  const deals = await db().select({ id: schema.deals.id, reference: schema.deals.reference, status: schema.deals.status }).from(schema.deals).where(inArray(schema.deals.id, ids));
  const orgIds = [...new Set(parts.map((p) => p.orgId).filter((x): x is string => Boolean(x)))];
  const orgs = orgIds.length ? await db().select().from(schema.organizations).where(inArray(schema.organizations.id, orgIds)) : [];
  const byKey = new Map<string, { name: string; roles: Set<string>; addresses: Set<string>; deals: { id: string; reference: string; status: string; role: string }[]; verification: string; jurisdiction: string | null; invited: boolean }>();
  for (const p of parts) {
    if (p.orgId && p.orgId === session.org?.id) continue;
    const org = orgs.find((o) => o.id === p.orgId);
    const key = org?.id ?? `${p.role}:${p.displayName}`;
    const entry = byKey.get(key) ?? { name: org?.legalName ?? p.displayName, roles: new Set(), addresses: new Set(), deals: [], verification: org?.verificationState ?? "unverified", jurisdiction: org?.jurisdiction ?? null, invited: false };
    entry.roles.add(p.role);
    if (p.signingAddress) entry.addresses.add(p.signingAddress);
    if (p.status === "invited") entry.invited = true;
    const deal = deals.find((d) => d.id === p.dealId);
    if (deal) entry.deals.push({ ...deal, role: p.role });
    byKey.set(key, entry);
  }
  return [...byKey.entries()].map(([key, e]) => ({ key, name: e.name, roles: [...e.roles], addresses: [...e.addresses], deals: e.deals, verification: e.verification, jurisdiction: e.jurisdiction, invited: e.invited }));
}

export async function notificationsFor(session: SessionContext) {
  return db().select().from(schema.notifications).where(eq(schema.notifications.userId, session.user.id)).orderBy(desc(schema.notifications.createdAt)).limit(100);
}

export async function unreadCount(session: SessionContext): Promise<number> {
  const [row] = await db().select({ n: sql<number>`count(*)::int` }).from(schema.notifications).where(and(eq(schema.notifications.userId, session.user.id), isNull(schema.notifications.readAt)));
  return row?.n ?? 0;
}

export async function markNotificationsRead(session: SessionContext, ids: string[] | "all"): Promise<void> {
  const base = and(eq(schema.notifications.userId, session.user.id), isNull(schema.notifications.readAt));
  await db().update(schema.notifications).set({ readAt: new Date() }).where(ids === "all" ? base : and(base, inArray(schema.notifications.id, ids)));
}

export function money(units: string | bigint, code: string): string {
  return `${formatAmount(BigInt(units))} ${code}`;
}
