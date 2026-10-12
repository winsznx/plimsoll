import { and, inArray } from "drizzle-orm";
import type { ChainSnapshot } from "@plimsoll/domain";
import { db, schema } from "../db/client";
import { DEAL_STATUSES, type DealStatus } from "../db/schema";
import type { SessionContext } from "../auth/session";
import { listDeals } from "./deals";
import { isBlockingOpen } from "./reconcile";
import { loadSnapshot } from "./snapshot";

export const DEAL_INDEX_VIEWS = ["action"] as const;
export const DEAL_INDEX_SORTS = ["updated", "value", "reference"] as const;
export type DealIndexSort = (typeof DEAL_INDEX_SORTS)[number];

export interface DealIndexFilter {
  q: string;
  status: DealStatus | null;
  view: (typeof DEAL_INDEX_VIEWS)[number] | null;
  sort: DealIndexSort;
}

export interface DealIndexRow {
  id: string;
  reference: string;
  title: string;
  cargo: string;
  status: DealStatus;
  isSample: boolean;
  myRoles: string[];
  buyer: string;
  supplier: string;
  counterparty: string;
  originPort: string;
  destinationPort: string;
  transportMode: string;
  incoterm: string;
  assetCode: string;
  totalUnits: string;
  /** Null until the escrow has been read from chain at least once. */
  fundedUnits: string | null;
  escrowUnits: string | null;
  syncStatus: "never" | "ok" | "unavailable";
  nextCondition: string;
  blockingFindings: number;
  openDisputes: number;
  myAction: string | null;
  updatedAt: string;
}

export function parseDealIndexFilter(read: (key: string) => string | undefined): DealIndexFilter {
  const status = read("status");
  const view = read("view");
  const sort = read("sort");
  return {
    q: (read("q") ?? "").trim(),
    status: DEAL_STATUSES.find((s) => s === status) ?? null,
    view: DEAL_INDEX_VIEWS.find((v) => v === view) ?? null,
    sort: DEAL_INDEX_SORTS.find((s) => s === sort) ?? "updated",
  };
}

function nextCondition(status: DealStatus, terms: { milestones: { name: string }[] }, snap: ChainSnapshot | null): string {
  if (status === "draft") return "Buyer freezes terms and deploys escrow";
  if (status === "awaiting_acceptance") return "Both parties accept terms on-chain";
  if (status === "awaiting_funding") return "Buyer funds escrow";
  if (status === "completed") return "Completed";
  if (status === "cancelled") return "Cancelled";
  if (!snap) return "Waiting for first chain readback";
  const open = snap.milestones.find((m) => m.status === "Open" || m.status === "Disputed");
  if (!open) return "All milestones settled";
  const name = terms.milestones[open.id]?.name ?? `Milestone ${open.id + 1}`;
  if (open.status === "Disputed") return `${name}: disputed, awaiting resolver`;
  return open.evidenceDigest ? `${name}: ${open.approvals.length}/${open.quorum} approvals` : `${name}: evidence`;
}

/**
 * The deals index and its CSV export share one row builder so the export is always exactly
 * what the table shows for the same query string.
 */
export async function dealIndex(session: SessionContext, filter: DealIndexFilter): Promise<{ rows: DealIndexRow[]; visible: number }> {
  const deals = await listDeals(session);
  if (deals.length === 0) return { rows: [], visible: 0 };
  const ids = deals.map((d) => d.id);
  const [discrepancies, disputes, participants] = await Promise.all([
    db().select({ dealId: schema.discrepancies.dealId, active: schema.discrepancies.active, severity: schema.discrepancies.severity, state: schema.discrepancies.state }).from(schema.discrepancies).where(inArray(schema.discrepancies.dealId, ids)),
    db().select().from(schema.disputes).where(and(inArray(schema.disputes.dealId, ids), inArray(schema.disputes.status, ["opening", "open"]))),
    db().select({ dealId: schema.dealParticipants.dealId, role: schema.dealParticipants.role, userId: schema.dealParticipants.userId }).from(schema.dealParticipants).where(inArray(schema.dealParticipants.dealId, ids)),
  ]);
  const mine = new Set(session.wallets.map((w) => w.address));
  const orgId = session.org?.id;

  const rows = deals.map((d): DealIndexRow => {
    const snap = d.chainSnapshot ? loadSnapshot(d.chainSnapshot) : null;
    const isBuyer = d.buyerOrgId === orgId;
    const isSupplier = d.supplierOrgId !== null && d.supplierOrgId === orgId;
    const roles = new Set<string>();
    if (isBuyer) roles.add("buyer");
    if (isSupplier) roles.add("supplier");
    for (const p of participants) if (p.dealId === d.id && p.userId === session.user.id) roles.add(p.role);

    const blocking = discrepancies.filter((x) => x.dealId === d.id && isBlockingOpen(x)).length;
    const dealDisputes = disputes.filter((x) => x.dealId === d.id);
    const items = d.terms.goods.lineItems;

    let myAction: string | null = null;
    if (d.status === "draft" && isBuyer) myAction = "Review draft and freeze terms";
    else if (d.status === "awaiting_acceptance" && snap) {
      if (isBuyer && !snap.agreement.buyerAccepted && mine.has(d.terms.buyer.address)) myAction = "Accept terms on-chain";
      if (isSupplier && !snap.agreement.supplierAccepted && mine.has(d.terms.supplier.address)) myAction = "Accept terms on-chain";
    } else if (d.status === "awaiting_funding" && isBuyer) myAction = "Fund escrow";
    if (!myAction && snap && d.status === "funded") {
      const waiting = snap.milestones.find((m) => m.status === "Open" && m.evidenceDigest && m.approvers.some((a) => mine.has(a) && !m.approvals.includes(a)));
      if (waiting) myAction = `Approve ${d.terms.milestones[waiting.id]?.name ?? `milestone ${waiting.id + 1}`}`;
    }
    const toResolve = dealDisputes.find((x) => mine.has(x.resolverAddress));
    if (!myAction && toResolve) myAction = `Resolve dispute on milestone ${toResolve.milestoneOrdinal + 1}`;
    if (!myAction && blocking > 0 && (isBuyer || isSupplier)) myAction = `Resolve ${blocking} blocking document mismatch${blocking === 1 ? "" : "es"}`;

    return {
      id: d.id,
      reference: d.reference,
      title: d.title,
      cargo: items.length === 0 ? "" : `${items[0]!.description}${items.length > 1 ? ` + ${items.length - 1} more` : ""}`,
      status: d.status,
      isSample: d.isSample,
      myRoles: [...roles],
      buyer: d.terms.buyer.legalName,
      supplier: d.terms.supplier.legalName,
      counterparty: isBuyer ? d.terms.supplier.legalName : isSupplier ? d.terms.buyer.legalName : `${d.terms.buyer.legalName} / ${d.terms.supplier.legalName}`,
      originPort: d.terms.goods.originPort,
      destinationPort: d.terms.goods.destinationPort,
      transportMode: d.terms.goods.transportMode,
      incoterm: `${d.terms.goods.incoterm.rule} ${d.terms.goods.incoterm.namedPlace}`,
      assetCode: d.terms.asset.code,
      totalUnits: d.terms.totalUnits,
      fundedUnits: snap ? String(snap.agreement.funded) : null,
      escrowUnits: snap ? String(snap.balance) : null,
      syncStatus: d.chainSyncStatus,
      nextCondition: nextCondition(d.status, d.terms, snap),
      blockingFindings: blocking,
      openDisputes: dealDisputes.length,
      myAction,
      updatedAt: d.updatedAt.toISOString(),
    };
  });

  const q = filter.q.toLowerCase();
  const filtered = rows.filter(
    (r) =>
      (!filter.status || r.status === filter.status) &&
      (!filter.view || r.myAction !== null) &&
      (!q || `${r.reference} ${r.title} ${r.cargo} ${r.buyer} ${r.supplier} ${r.originPort} ${r.destinationPort}`.toLowerCase().includes(q)),
  );
  if (filter.sort === "value") filtered.sort((a, b) => (BigInt(b.totalUnits) > BigInt(a.totalUnits) ? 1 : BigInt(b.totalUnits) < BigInt(a.totalUnits) ? -1 : 0));
  if (filter.sort === "reference") filtered.sort((a, b) => a.reference.localeCompare(b.reference, "en", { numeric: true }));
  return { rows: filtered, visible: rows.length };
}
