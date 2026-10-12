export const API_ERROR_CODES = [
  "UNAUTHENTICATED",
  "ROLE_DENIED",
  "NOT_FOUND",
  "VALIDATION_FAILED",
  "TERMS_VERSION_STALE",
  "SIGNATURE_EXPIRED",
  "TOKEN_NOT_ALLOWLISTED",
  "MILESTONE_DISPUTED",
  "APPROVAL_QUORUM_MISSING",
  "EVIDENCE_DIGEST_MISMATCH",
  "EVIDENCE_NOT_READY",
  "CHAIN_PENDING",
  "CHAIN_REJECTED",
  "RPC_UNAVAILABLE",
  "ALREADY_SETTLED",
  "RECONCILIATION_REQUIRED",
  "IDEMPOTENCY_CONFLICT",
  "WALLET_REQUIRED",
  "TRUSTLINE_MISSING",
  "INTERNAL",
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; details?: unknown; requestId: string; retryable: boolean };
}
