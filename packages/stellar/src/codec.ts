import { Address, nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";
import {
  AGREEMENT_STATUS_BY_CODE,
  MILESTONE_STATUS_BY_CODE,
  bytesToHex,
  hexToBytes,
  type ChainAgreement,
  type ChainMilestone,
  type DealTerms,
} from "@plimsoll/domain";

export const scv = {
  address: (a: string): xdr.ScVal => new Address(a).toScVal(),
  bytes32: (hex: string): xdr.ScVal => {
    const bytes = hexToBytes(hex);
    if (bytes.length !== 32) throw new RangeError("Expected 32-byte digest");
    return xdr.ScVal.scvBytes(Buffer.from(bytes));
  },
  i128: (v: bigint): xdr.ScVal => nativeToScVal(v, { type: "i128" }),
  u32: (v: number): xdr.ScVal => xdr.ScVal.scvU32(v),
  u64: (v: number | bigint): xdr.ScVal => nativeToScVal(BigInt(v), { type: "u64" }),
  vec: (items: xdr.ScVal[]): xdr.ScVal => xdr.ScVal.scvVec(items),
  /** Soroban `#[contracttype]` structs are symbol-keyed maps that must be sorted by key. */
  struct: (fields: Record<string, xdr.ScVal>): xdr.ScVal =>
    xdr.ScVal.scvMap(
      Object.keys(fields)
        .sort()
        .map((k) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k), val: fields[k]! })),
    ),
  /** Unit enum variants of a `#[contracttype]` enum key, e.g. `DataKey::Agreement`. */
  enumKey: (name: string, ...payload: xdr.ScVal[]): xdr.ScVal => xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(name), ...payload]),
};

export function policyScVal(terms: DealTerms): xdr.ScVal {
  return scv.struct({
    milestones: scv.vec(
      terms.milestones.map((m) =>
        scv.struct({
          amount: scv.i128(BigInt(m.amountUnits)),
          payee: scv.address(m.payee),
          approvers: scv.vec(m.approvers.map((a) => scv.address(a.address))),
          quorum: scv.u32(m.quorum),
          refund_after: scv.u64(m.refundAfter),
        }),
      ),
    ),
    resolver: scv.address(terms.resolver.address),
    funding_deadline: scv.u64(terms.fundingDeadline),
  });
}

export function constructorArgs(terms: DealTerms, dealIdHex: string, termsDigestHex: string): xdr.ScVal[] {
  return [
    scv.bytes32(dealIdHex),
    scv.address(terms.buyer.address),
    scv.address(terms.supplier.address),
    scv.address(terms.asset.contractId),
    scv.bytes32(termsDigestHex),
    policyScVal(terms),
  ];
}

function toHex(v: unknown): string {
  if (v instanceof Uint8Array) return bytesToHex(v);
  throw new TypeError("Expected bytes");
}

function optHex(v: unknown): string | null {
  return v === null || v === undefined ? null : toHex(v);
}

type NativeStruct = Record<string, unknown>;

export function decodeAgreement(val: xdr.ScVal): ChainAgreement {
  const n = scValToNative(val) as NativeStruct;
  return {
    dealId: toHex(n.deal_id),
    buyer: String(n.buyer),
    supplier: String(n.supplier),
    token: String(n.token),
    termsDigest: toHex(n.terms_digest),
    resolver: String(n.resolver),
    fundingDeadline: Number(n.funding_deadline),
    total: BigInt(n.total as bigint),
    funded: BigInt(n.funded as bigint),
    released: BigInt(n.released as bigint),
    refunded: BigInt(n.refunded as bigint),
    status: AGREEMENT_STATUS_BY_CODE[Number(n.status)]!,
    buyerAccepted: Boolean(n.buyer_accepted),
    supplierAccepted: Boolean(n.supplier_accepted),
    milestoneCount: Number(n.milestone_count),
    settledCount: Number(n.settled_count),
  };
}

export function decodeMilestone(val: xdr.ScVal): Omit<ChainMilestone, "approvals"> {
  const n = scValToNative(val) as NativeStruct;
  return {
    id: Number(n.id),
    amount: BigInt(n.amount as bigint),
    payee: String(n.payee),
    approvers: (n.approvers as unknown[]).map(String),
    quorum: Number(n.quorum),
    refundAfter: Number(n.refund_after),
    evidenceDigest: optHex(n.evidence_digest),
    status: MILESTONE_STATUS_BY_CODE[Number(n.status)]!,
    disputeReason: optHex(n.dispute_reason),
  };
}

/** JSON-safe view of an event payload: bigints become decimal strings, bytes become hex. */
export function toJsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return bytesToHex(value);
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toJsonSafe(v)]));
  }
  return value;
}
