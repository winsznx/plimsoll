import { describe, expect, it } from "vitest";
import { Account, BASE_FEE, Contract, Keypair, Networks, Operation, TransactionBuilder, scValToNative, type Transaction, type xdr } from "@stellar/stellar-sdk";
import { assertSponsorable, cursorLedger, isTransportFailure, parseContractError, scv } from "./index";

const CONTRACT = "CDXPYF5YZ3SYTUB5OS5T3NUQWH34G65RBGIB2YTECWZ4Y35TP3IAJE2B";

function invocation(signer: Keypair, method: string, args: xdr.ScVal[], contract = CONTRACT): Transaction {
  const tx = new TransactionBuilder(new Account(signer.publicKey(), "1"), { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(new Contract(contract).call(method, ...args))
    .setTimeout(300)
    .build();
  tx.sign(signer);
  return tx;
}

describe("assertSponsorable", () => {
  const signer = Keypair.random();
  const policy = { contractId: CONTRACT, method: "approve_milestone" as const, signer: signer.publicKey() };
  const args = [scv.address(signer.publicKey()), scv.u32(1), scv.bytes32("ab".repeat(32))];

  it("accepts the exact expected call signed by the participant", () => {
    // #given
    const tx = invocation(signer, "approve_milestone", args);
    // #then
    expect(() => assertSponsorable(tx, policy)).not.toThrow();
  });

  it("refuses a different method", () => {
    // #given
    const tx = invocation(signer, "release_milestone", [scv.u32(1)]);
    // #then
    expect(() => assertSponsorable(tx, policy)).toThrow(/Expected approve_milestone/);
  });

  it("refuses a different contract", () => {
    // #given
    const tx = invocation(signer, "approve_milestone", args, "CAQAB2RFHPXYZRE3UA7XRI5Q6ZRPAHHDGNA3NJLL6LJANH6HS3264F3W");
    // #then
    expect(() => assertSponsorable(tx, policy)).toThrow(/unexpected contract/);
  });

  it("refuses a transaction signed by someone else", () => {
    // #given
    const intruder = Keypair.random();
    const tx = invocation(signer, "approve_milestone", args);
    tx.signatures.length = 0;
    tx.sign(intruder);
    // #then
    expect(() => assertSponsorable(tx, policy)).toThrow(/not signed by the participant/);
  });

  it("refuses a signer argument that differs from the source", () => {
    // #given
    const other = Keypair.random();
    const tx = invocation(signer, "approve_milestone", [scv.address(other.publicKey()), scv.u32(1), scv.bytes32("ab".repeat(32))]);
    // #then
    expect(() => assertSponsorable(tx, policy)).toThrow(/Signer argument/);
  });

  it("refuses extra operations", () => {
    // #given
    const tx = new TransactionBuilder(new Account(signer.publicKey(), "1"), { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
      .addOperation(new Contract(CONTRACT).call("approve_milestone", ...args))
      .addOperation(Operation.bumpSequence({ bumpTo: "10" }))
      .setTimeout(300)
      .build();
    tx.sign(signer);
    // #then
    expect(() => assertSponsorable(tx, policy)).toThrow(/Exactly one operation/);
  });
});

describe("codec", () => {
  it("encodes contract structs as maps sorted by field name", () => {
    // #given
    const v = scv.struct({ to_payee: scv.i128(2n), to_buyer: scv.i128(1n) });
    // #then
    expect(Object.keys(scValToNative(v) as object)).toEqual(["to_buyer", "to_payee"]);
  });

  it("rejects digests that are not 32 bytes", () => {
    expect(() => scv.bytes32("abcd")).toThrow(/32-byte/);
  });

  it("classifies only transport failures as RPC outages", () => {
    const network = Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("connect"), { code: "ECONNRESET" }) });
    const http503 = Object.assign(new Error("Request failed"), { response: { status: 503 } });
    const xdrBug = new TypeError("scvSymbol.sym: expected string, Uint8Array, or XdrString");
    expect([isTransportFailure(network), isTransportFailure(http503), isTransportFailure(xdrBug)]).toEqual([true, true, false]);
  });

  it("reads the ledger sequence from an event cursor's TOID", () => {
    expect(cursorLedger("0022137820553089024-0000000001")).toBe(5154363);
    expect(cursorLedger(undefined)).toBeNull();
  });

  it("extracts contract error codes from host diagnostics", () => {
    expect(parseContractError("HostError: Error(Contract, #12)\nEvent log...")).toBe(12);
    expect(parseContractError("HostError: Error(Auth, InvalidAction)")).toBeNull();
  });
});
