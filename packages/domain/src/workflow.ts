import type { ChainMilestone, ChainSnapshot } from "./chain";

export type MilestoneAction =
  | "anchor_evidence"
  | "approve"
  | "revoke_approval"
  | "release"
  | "open_dispute"
  | "resolve_dispute"
  | "refund_expired";

export type MilestonePhase =
  | "waiting_evidence"
  | "under_review"
  | "pending_authorizations"
  | "eligible"
  | "released"
  | "blocked"
  | "disputed"
  | "resolved"
  | "refunded";

export interface OffchainMilestoneState {
  ordinal: number;
  openBlockingFindings: number;
  /** Digest of the reviewed evidence bundle the app would anchor, if one is ready. */
  preparedBundleDigest: string | null;
  missingDocuments: string[];
}

export interface MilestoneGate {
  ordinal: number;
  phase: MilestonePhase;
  allowed: MilestoneAction[];
  /** Human sentences for the "why not yet" line under disabled actions. */
  blockedReasons: Partial<Record<MilestoneAction, string>>;
  approvals: number;
  quorum: number;
}

export interface GateContext {
  snapshot: ChainSnapshot;
  offchain: OffchainMilestoneState[];
  actorAddress: string | null;
  nowSeconds: number;
  names: ReadonlyMap<string, string>;
}

function nameOf(ctx: GateContext, address: string): string {
  return ctx.names.get(address) ?? `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function milestoneGate(ctx: GateContext, m: ChainMilestone): MilestoneGate {
  const off = ctx.offchain.find((o) => o.ordinal === m.id);
  const a = ctx.snapshot.agreement;
  const actor = ctx.actorAddress;
  const allowed: MilestoneAction[] = [];
  const blocked: Partial<Record<MilestoneAction, string>> = {};
  const isParty = actor !== null && (actor === a.buyer || actor === a.supplier);
  const isApprover = actor !== null && m.approvers.includes(actor);
  const hasApproved = actor !== null && m.approvals.includes(actor);
  const missingSigners = m.approvers.filter((x) => !m.approvals.includes(x)).map((x) => nameOf(ctx, x));
  const funded = a.status === "Funded";
  const contractLive = a.status === "AwaitingFunding" || a.status === "Funded";

  const settledPhase: Record<string, MilestonePhase> = { Released: "released", Resolved: "resolved", Refunded: "refunded" };
  if (settledPhase[m.status]) {
    return { ordinal: m.id, phase: settledPhase[m.status]!, allowed: [], blockedReasons: {}, approvals: m.approvals.length, quorum: m.quorum };
  }

  if (m.status === "Disputed") {
    if (actor === a.resolver) allowed.push("resolve_dispute");
    else blocked.resolve_dispute = `Only the named resolver ${nameOf(ctx, a.resolver)} can allocate disputed funds.`;
    blocked.release = "Frozen by an open dispute on this milestone. Other milestones are unaffected.";
    return { ordinal: m.id, phase: "disputed", allowed, blockedReasons: blocked, approvals: m.approvals.length, quorum: m.quorum };
  }

  const openFindings = off?.openBlockingFindings ?? 0;
  const missingDocs = off?.missingDocuments ?? [];
  const prepared = off?.preparedBundleDigest ?? null;
  const anchoredCurrent = prepared !== null && m.evidenceDigest === prepared;

  if (!contractLive) blocked.anchor_evidence = "Both parties must accept the terms on-chain first.";
  else if (!(isParty || isApprover)) blocked.anchor_evidence = "Only the buyer, supplier or an appointed approver can anchor evidence.";
  else if (missingDocs.length > 0) blocked.anchor_evidence = `Missing required documents: ${missingDocs.join(", ")}.`;
  else if (openFindings > 0) blocked.anchor_evidence = `${openFindings} blocking discrepanc${openFindings === 1 ? "y remains" : "ies remain"} open.`;
  else if (prepared === null) blocked.anchor_evidence = "Prepare the evidence bundle after review.";
  else if (anchoredCurrent) blocked.anchor_evidence = "The current evidence bundle is already anchored.";
  else allowed.push("anchor_evidence");

  if (!isApprover) blocked.approve = "You are not an appointed approver for this milestone.";
  else if (m.evidenceDigest === null) blocked.approve = "No evidence bundle has been anchored on-chain yet.";
  else if (hasApproved) blocked.approve = "You have approved the current evidence.";
  else if (prepared !== null && m.evidenceDigest !== prepared) blocked.approve = "Anchored evidence is stale; the reviewed bundle has changed and must be re-anchored.";
  else allowed.push("approve");

  if (hasApproved) allowed.push("revoke_approval");

  const quorumMet = m.approvals.length >= m.quorum;
  if (!funded) blocked.release = a.status === "AwaitingFunding" ? "Escrow is not fully funded yet." : "Agreement is not active.";
  else if (m.evidenceDigest === null) blocked.release = "No evidence bundle has been anchored on-chain.";
  else if (!quorumMet) blocked.release = `Awaiting ${m.quorum - m.approvals.length} more approval${m.quorum - m.approvals.length === 1 ? "" : "s"} on current evidence (${missingSigners.join(", ")}).`;
  else allowed.push("release");

  if (funded && isParty) allowed.push("open_dispute");
  else blocked.open_dispute = funded ? "Only the buyer or supplier can open a dispute." : "Disputes apply to funded escrow only.";

  if (funded && m.refundAfter > 0 && ctx.nowSeconds >= m.refundAfter) allowed.push("refund_expired");
  else blocked.refund_expired = m.refundAfter === 0 ? "This milestone has no timed refund path." : `Refund path opens ${new Date(m.refundAfter * 1000).toISOString().slice(0, 10)}.`;

  let phase: MilestonePhase;
  if (allowed.includes("release")) phase = "eligible";
  else if (m.evidenceDigest !== null) phase = "pending_authorizations";
  else if (openFindings > 0) phase = "blocked";
  else if (prepared !== null || missingDocs.length === 0) phase = "under_review";
  else phase = "waiting_evidence";

  return { ordinal: m.id, phase, allowed, blockedReasons: blocked, approvals: m.approvals.length, quorum: m.quorum };
}

/** `total_funded = total_released + total_refunded + escrow_balance`, checked against token state. */
export function conservationHolds(s: ChainSnapshot): boolean {
  return s.agreement.funded === s.agreement.released + s.agreement.refunded + s.balance;
}
