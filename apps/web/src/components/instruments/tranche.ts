import type { MilestoneView } from "@/lib/views";

export type TrancheState = "released" | "refunded" | "eligible" | "held" | "disputed" | "waiting";

export interface Tranche {
  ordinal: number;
  name: string;
  amount: bigint;
  state: TrancheState;
  /** Released within the last minute: plays the release motion once. */
  fresh?: boolean;
}

/** One vocabulary for tranche state across gauge, rail and tables, derived only from chain-backed views. */
export function trancheState(m: Pick<MilestoneView, "chainStatus" | "gate" | "openBlockingFindings">): TrancheState {
  if (m.chainStatus === "Released" || m.chainStatus === "Resolved") return "released";
  if (m.chainStatus === "Refunded") return "refunded";
  if (m.chainStatus === "Disputed") return "disputed";
  if (m.gate?.phase === "eligible") return "eligible";
  if (m.gate?.phase === "blocked" || m.openBlockingFindings > 0) return "held";
  return "waiting";
}

export function tranchesOf(milestones: MilestoneView[]): Tranche[] {
  const now = Date.now();
  return milestones.map((m) => ({
    ordinal: m.ordinal,
    name: m.name,
    amount: BigInt(m.amount),
    state: trancheState(m),
    fresh: Boolean(m.settlementTx && now - new Date(m.settlementTx.createdAt).getTime() < 60_000),
  }));
}

export const STATE_LABEL: Record<TrancheState, string> = {
  released: "Released",
  refunded: "Refunded",
  eligible: "Ready to release",
  held: "Held",
  disputed: "Disputed",
  waiting: "Waiting",
};
