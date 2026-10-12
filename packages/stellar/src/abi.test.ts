import { describe, expect, it } from "vitest";
import { Keypair, contract, xdr as X } from "@stellar/stellar-sdk";
import type { DealTerms } from "@plimsoll/domain";
import { constructorArgs, decodeAgreement, decodeMilestone, scv } from "./codec";
import specFile from "./generated/trade-escrow.spec.json";

/**
 * The contract's own ABI (exported from the wasm by scripts/export-contract-spec.ts) is the
 * source of truth. Every argument the app sends and every state struct it decodes must agree
 * with it byte for byte; CI fails if the committed spec drifts from the built contract.
 */
const spec = new contract.Spec(specFile.entries);
const g = () => Keypair.random().publicKey();
const hex = (b: number) => b.toString(16).padStart(2, "0").repeat(32);
const buf = (h: string) => Buffer.from(h, "hex");
const xdrOf = (vals: X.ScVal[]) => vals.map((v) => v.toXDR("base64"));

const buyer = g();
const supplier = g();
const inspector = g();
const resolver = g();
const token = "CDXPYF5YZ3SYTUB5OS5T3NUQWH34G65RBGIB2YTECWZ4Y35TP3IAJE2B";

const terms = {
  buyer: { address: buyer },
  supplier: { address: supplier },
  asset: { contractId: token },
  resolver: { address: resolver },
  fundingDeadline: 1_800_000_000,
  milestones: [
    { amountUnits: "297200000000", payee: supplier, approvers: [{ address: buyer }], quorum: 1, refundAfter: 0 },
    { amountUnits: "891600000000", payee: supplier, approvers: [{ address: buyer }, { address: inspector }], quorum: 2, refundAfter: 1_810_000_000 },
  ],
} as unknown as DealTerms;

describe("contract ABI conformance", () => {
  it("constructor arguments match the spec encoding exactly", () => {
    // #given
    const fromSpec = spec.funcArgsToScVals("__constructor", {
      deal_id: buf(hex(1)),
      buyer,
      supplier,
      token,
      terms_digest: buf(hex(2)),
      policy: {
        milestones: terms.milestones.map((m) => ({ amount: BigInt(m.amountUnits), payee: m.payee, approvers: m.approvers.map((a) => a.address), quorum: m.quorum, refund_after: BigInt(m.refundAfter) })),
        resolver,
        funding_deadline: BigInt(terms.fundingDeadline),
      },
    });
    // #then
    expect(xdrOf(constructorArgs(terms, hex(1), hex(2)))).toEqual(xdrOf(fromSpec));
  });

  it.each([
    ["accept_terms", () => [scv.address(buyer), scv.bytes32(hex(3))], { signer: buyer, terms_digest: buf(hex(3)) }],
    ["fund", () => [scv.address(buyer), scv.address(token), scv.i128(5n)], { buyer, token, amount: 5n }],
    ["anchor_evidence", () => [scv.address(supplier), scv.u32(1), scv.bytes32(hex(4))], { submitter: supplier, milestone_id: 1, bundle_digest: buf(hex(4)) }],
    ["approve_milestone", () => [scv.address(inspector), scv.u32(1), scv.bytes32(hex(4))], { signer: inspector, milestone_id: 1, bundle_digest: buf(hex(4)) }],
    ["revoke_approval", () => [scv.address(inspector), scv.u32(1)], { signer: inspector, milestone_id: 1 }],
    ["release_milestone", () => [scv.u32(1)], { milestone_id: 1 }],
    ["open_dispute", () => [scv.address(buyer), scv.u32(1), scv.bytes32(hex(5))], { actor: buyer, milestone_id: 1, reason_digest: buf(hex(5)) }],
    ["resolve_dispute", () => [scv.address(resolver), scv.u32(1), scv.struct({ to_buyer: scv.i128(7n), to_payee: scv.i128(9n) })], { resolver, milestone_id: 1, allocation: { to_buyer: 7n, to_payee: 9n } }],
    ["refund_expired", () => [scv.u32(1)], { milestone_id: 1 }],
    ["cancel_unfunded", () => [scv.address(buyer)], { actor: buyer }],
  ] as const)("%s arguments match the spec encoding", (method, ours, native) => {
    expect(xdrOf(ours())).toEqual(xdrOf(spec.funcArgsToScVals(method, native)));
  });

  it("decodes Agreement exactly as the spec defines it", () => {
    // #given
    const native = {
      deal_id: buf(hex(1)),
      buyer,
      supplier,
      token,
      terms_digest: buf(hex(2)),
      resolver,
      funding_deadline: 1_800_000_000n,
      total: 100n,
      funded: 60n,
      released: 20n,
      refunded: 10n,
      status: 2,
      buyer_accepted: true,
      supplier_accepted: false,
      milestone_count: 2,
      settled_count: 1,
    };
    const encoded = spec.nativeToScVal(native, X.ScSpecTypeDef.scSpecTypeUdt(new X.ScSpecTypeUdt({ name: "Agreement" })));
    // #when
    const decoded = decodeAgreement(encoded);
    // #then
    expect(decoded).toEqual({
      dealId: hex(1), buyer, supplier, token, termsDigest: hex(2), resolver, fundingDeadline: 1_800_000_000,
      total: 100n, funded: 60n, released: 20n, refunded: 10n, status: "Funded", buyerAccepted: true, supplierAccepted: false, milestoneCount: 2, settledCount: 1,
    });
  });

  it("decodes Milestone exactly as the spec defines it, including empty options", () => {
    // #given
    const native = { id: 1, amount: 50n, payee: supplier, approvers: [buyer, inspector], quorum: 2, refund_after: 0n, evidence_digest: buf(hex(4)), status: 1, dispute_reason: undefined };
    const encoded = spec.nativeToScVal(native, X.ScSpecTypeDef.scSpecTypeUdt(new X.ScSpecTypeUdt({ name: "Milestone" })));
    // #then
    expect(decodeMilestone(encoded)).toEqual({ id: 1, amount: 50n, payee: supplier, approvers: [buyer, inspector], quorum: 2, refundAfter: 0, evidenceDigest: hex(4), status: "Disputed", disputeReason: null });
  });

  it("storage keys use the spec's DataKey shapes", () => {
    const key = (v: unknown) => spec.nativeToScVal(v, X.ScSpecTypeDef.scSpecTypeUdt(new X.ScSpecTypeUdt({ name: "DataKey" }))).toXDR("base64");
    expect(scv.enumKey("Agreement").toXDR("base64")).toBe(key({ tag: "Agreement", values: undefined }));
    expect(scv.enumKey("Milestone", scv.u32(3)).toXDR("base64")).toBe(key({ tag: "Milestone", values: [3] }));
    expect(scv.enumKey("Approval", scv.u32(3), scv.address(buyer)).toXDR("base64")).toBe(key({ tag: "Approval", values: [3, buyer] }));
  });

  it("every contract error the app explains is declared in the spec", async () => {
    const { CONTRACT_ERRORS } = await import("@plimsoll/domain");
    const declared = specFile.entries.map((b) => Buffer.from(b, "base64").toString("latin1")).join("\n");
    expect(Object.values(CONTRACT_ERRORS).filter(({ code }) => !declared.includes(code))).toEqual([]);
  });
});
