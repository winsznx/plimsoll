/** Mirrors of the on-chain TradeEscrow types, decoded from contract state. */

export type ChainAgreementStatus = "AwaitingAcceptance" | "AwaitingFunding" | "Funded" | "Completed" | "Cancelled";
export type ChainMilestoneStatus = "Open" | "Disputed" | "Released" | "Resolved" | "Refunded";

export const AGREEMENT_STATUS_BY_CODE: readonly ChainAgreementStatus[] = ["AwaitingAcceptance", "AwaitingFunding", "Funded", "Completed", "Cancelled"];
export const MILESTONE_STATUS_BY_CODE: readonly ChainMilestoneStatus[] = ["Open", "Disputed", "Released", "Resolved", "Refunded"];

export interface ChainAgreement {
  dealId: string;
  buyer: string;
  supplier: string;
  token: string;
  termsDigest: string;
  resolver: string;
  fundingDeadline: number;
  total: bigint;
  funded: bigint;
  released: bigint;
  refunded: bigint;
  status: ChainAgreementStatus;
  buyerAccepted: boolean;
  supplierAccepted: boolean;
  milestoneCount: number;
  settledCount: number;
}

export interface ChainMilestone {
  id: number;
  amount: bigint;
  payee: string;
  approvers: string[];
  quorum: number;
  refundAfter: number;
  evidenceDigest: string | null;
  status: ChainMilestoneStatus;
  disputeReason: string | null;
  /** Approvers whose approval matches the current evidence digest. */
  approvals: string[];
}

export interface ChainSnapshot {
  contractId: string;
  ledger: number;
  readAt: string;
  agreement: ChainAgreement;
  milestones: ChainMilestone[];
  /** Token balance held by the escrow, read from the token contract. */
  balance: bigint;
}

export const CONTRACT_ERRORS: Record<number, { code: string; explanation: string }> = {
  1: { code: "InvalidPolicy", explanation: "The agreement policy is malformed (quorum, approvers or milestones)." },
  2: { code: "InvalidAmount", explanation: "Amounts must be positive whole token units." },
  3: { code: "NotParty", explanation: "This address is not a party to the agreement." },
  4: { code: "TermsDigestMismatch", explanation: "The signed terms digest differs from the one fixed in the contract." },
  5: { code: "WrongStatus", explanation: "The agreement is not in a state that allows this action." },
  6: { code: "TokenMismatch", explanation: "Only the asset fixed at deployment can fund this escrow." },
  7: { code: "OverFunded", explanation: "Funding would exceed the agreement total." },
  8: { code: "UnknownMilestone", explanation: "No such milestone in this agreement." },
  9: { code: "NotAppointedApprover", explanation: "This signer is not an appointed approver for the milestone." },
  10: { code: "EvidenceNotAnchored", explanation: "No evidence bundle digest has been anchored for this milestone." },
  11: { code: "EvidenceDigestMismatch", explanation: "The approval references evidence that is no longer current." },
  12: { code: "QuorumNotMet", explanation: "The required number of appointed approvals on current evidence has not been reached." },
  13: { code: "MilestoneNotOpen", explanation: "The milestone is already released, resolved or refunded." },
  14: { code: "NotFullyFunded", explanation: "The escrow is not fully funded." },
  15: { code: "NotResolver", explanation: "Only the resolver named in the accepted terms may resolve disputes." },
  16: { code: "AllocationMismatch", explanation: "A resolution must allocate exactly the milestone amount." },
  17: { code: "RefundNotDue", explanation: "The refund deadline for this milestone has not passed or no refund path exists." },
  18: { code: "CancelNotAllowed", explanation: "Cancellation is only possible before full funding, and after the funding deadline once funds are deposited." },
  19: { code: "ApprovalNotFound", explanation: "There is no approval to revoke." },
  20: { code: "MilestoneDisputed", explanation: "The milestone is frozen by an open dispute." },
  21: { code: "Overflow", explanation: "Arithmetic overflow." },
};
