import type { DealView } from "./views";

/**
 * Chain state that can change without anyone on this page acting: a deployed escrow not yet read
 * back, a submitted transaction awaiting the ledger, an RPC outage that will recover, or a
 * milestone anyone may now release.
 */
export function chainInFlight(deal: DealView): boolean {
  return (
    (deal.status !== "draft" && deal.chain === null) ||
    deal.transactions.some((t) => t.status === "pending") ||
    deal.chain?.syncStatus === "unavailable" ||
    deal.milestones.some((m) => m.gate?.phase === "eligible")
  );
}

export function dealInFlight(deal: DealView): boolean {
  return chainInFlight(deal) || deal.documentsSummary.processing > 0;
}
