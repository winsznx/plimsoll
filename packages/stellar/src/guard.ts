import { Address, Keypair, StrKey, scValToNative, type Transaction } from "@stellar/stellar-sdk";

export const SPONSORED_METHODS = [
  "accept_terms",
  "fund",
  "anchor_evidence",
  "approve_milestone",
  "revoke_approval",
  "open_dispute",
  "resolve_dispute",
  "cancel_unfunded",
] as const;
export type SponsoredMethod = (typeof SPONSORED_METHODS)[number];

export interface SponsorshipPolicy {
  contractId: string;
  method: SponsoredMethod;
  signer: string;
}

/**
 * The relayer refuses to sponsor anything except the single, expected escrow call signed by the
 * expected account. It never forwards arbitrary invocations.
 */
export function assertSponsorable(tx: Transaction, policy: SponsorshipPolicy): void {
  if (tx.source !== policy.signer) throw new Error("Transaction source must be the signing participant.");
  if (tx.operations.length !== 1) throw new Error("Exactly one operation may be sponsored.");
  const op = tx.operations[0]!;
  if (op.type !== "invokeHostFunction") throw new Error("Only contract invocations may be sponsored.");
  const fn = op.func;
  if (fn.type !== "hostFunctionTypeInvokeContract") throw new Error("Only contract calls may be sponsored.");
  const invoke = fn.invokeContract;
  const target = Address.fromScAddress(invoke.contractAddress).toString();
  if (target !== policy.contractId) throw new Error("Transaction targets an unexpected contract.");
  const method = invoke.functionName.toString();
  if (method !== policy.method) throw new Error(`Expected ${policy.method}, got ${method}.`);
  const firstArg = invoke.args[0];
  if (firstArg && scValToNative(firstArg) !== policy.signer) throw new Error("Signer argument does not match transaction source.");

  const hash = tx.hash();
  const kp = Keypair.fromPublicKey(policy.signer);
  const hint = Buffer.from(kp.signatureHint());
  const signed = tx.signatures.some((s) => Buffer.from(s.hint.toBytes()).equals(hint) && kp.verify(hash, s.signature));
  if (!signed) throw new Error("Transaction is not signed by the participant.");
  if (!StrKey.isValidEd25519PublicKey(policy.signer)) throw new Error("Signer must be a Stellar account address.");
}
