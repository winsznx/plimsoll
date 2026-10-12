/**
 * Independent testnet verification (PRD §10.1, engineering/contract-lifecycle.md).
 *
 * Deploys a fresh escrow, drives positive and negative scenarios with the demo personas, and
 * asserts outcomes only from ledger readback and token balance deltas, never from API results.
 * Writes a receipt with every transaction hash to evidence/verify-<timestamp>.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Keypair, type xdr } from "@stellar/stellar-sdk";
import { conservationHolds, dealIdDigest, disputeReasonDigest, evidenceDigest, formatAmount, parseAmount, termsDigest, type DealTerms } from "@plimsoll/domain";
import { ChainRejectedError, EscrowGateway, constructorArgs, explorerUrl, resolveNetwork, scv, tokenBalance } from "@plimsoll/stellar";
import { readEnvFile } from "./env-file";

const ROOT = resolve(import.meta.dirname, "..");
const env = { ...readEnvFile(resolve(ROOT, "apps/web/.env.local")), ...process.env } as Record<string, string>;

function required(name: string): string {
  const v = env[name];
  if (!v) throw new Error(`${name} missing; run pnpm bootstrap:testnet first`);
  return v;
}

interface Trial {
  name: string;
  expect: "success" | "rejected";
  pass: boolean;
  txHash: string | null;
  ledger: number | null;
  detail: string;
  balanceDelta?: Record<string, string>;
}

async function main(): Promise<void> {
  const network = resolveNetwork(env.STELLAR_NETWORK, env.STELLAR_RPC_URL || undefined);
  const relayer = Keypair.fromSecret(required("PLIMSOLL_RELAYER_SECRET"));
  const buyer = Keypair.fromSecret(required("DEMO_BUYER_SECRET"));
  const supplier = Keypair.fromSecret(required("DEMO_SUPPLIER_SECRET"));
  const inspector = Keypair.fromSecret(required("DEMO_INSPECTOR_SECRET"));
  const resolver = Keypair.fromSecret(required("DEMO_RESOLVER_SECRET"));
  const asset = { code: required("PLIMSOLL_ASSET_CODE"), issuer: required("PLIMSOLL_ASSET_ISSUER") };
  const tokenId = required("PLIMSOLL_TOKEN_CONTRACT_ID");
  const gw = new EscrowGateway(network, relayer);
  const trials: Trial[] = [];

  const dealId = randomUUID();
  const total = parseAmount("1000");
  const terms: DealTerms = {
    schema: "plimsoll.terms.v1",
    dealId,
    reference: "VERIFY",
    poNumber: "PO-VERIFY",
    network: network.id,
    asset: { ...asset, contractId: tokenId, currency: "USD" },
    buyer: { orgId: "verify-buyer", legalName: "Verification Buyer", address: buyer.publicKey() },
    supplier: { orgId: "verify-supplier", legalName: "Verification Supplier", address: supplier.publicKey() },
    resolver: { name: "Verification Resolver", address: resolver.publicKey() },
    goods: {
      lineItems: [{ sku: "SKU", description: "Verification goods", quantity: 1, uom: "unit", unitPriceUnits: String(total), totalUnits: String(total) }],
      incoterm: { rule: "FOB", namedPlace: "Ningbo", edition: "Incoterms® 2020" },
      transportMode: "sea",
      originPort: "Ningbo",
      destinationPort: "Felixstowe",
    },
    governingLaw: "England and Wales",
    disputeForum: "Named resolver",
    totalUnits: String(total),
    fundingDeadline: 0,
    tolerances: { quantityBps: 0, weightBps: 200 },
    milestones: [
      { ordinal: 0, name: "Carrier handoff", condition: "Inspector + buyer approve", amountUnits: String(parseAmount("600")), payee: supplier.publicKey(), approvers: [{ address: buyer.publicKey(), role: "buyer", name: "Buyer" }, { address: inspector.publicKey(), role: "inspector", name: "Inspector" }], quorum: 2, refundAfter: 0, requiredDocuments: [] },
      { ordinal: 1, name: "Receipt", condition: "Buyer confirms", amountUnits: String(parseAmount("400")), payee: supplier.publicKey(), approvers: [{ address: buyer.publicKey(), role: "buyer", name: "Buyer" }], quorum: 1, refundAfter: 0, requiredDocuments: [] },
    ],
  };

  const dealHex = await dealIdDigest(dealId);
  const termsHex = await termsDigest(terms);
  console.log(`Deploying escrow for verification deal ${dealId}`);
  const deployed = await gw.deployEscrow({ wasmHash: required("PLIMSOLL_ESCROW_WASM_HASH"), constructorArgs: constructorArgs(terms, dealHex, termsHex), salt: Buffer.from(dealHex, "hex") });
  const contractId = deployed.contractId;
  console.log(`  escrow ${contractId} (tx ${deployed.hash})`);

  const signed = async (who: Keypair, method: string, args: xdr.ScVal[]) => {
    const tx = await gw.prepareInvocation({ contractId, method, args, source: who.publicKey() });
    tx.sign(who);
    return gw.submitSponsored(tx);
  };
  const balances = async () => ({
    buyer: await tokenBalance(gw, buyer.publicKey(), asset),
    supplier: await tokenBalance(gw, supplier.publicKey(), asset),
    escrow: (await gw.readSnapshot(contractId, asset)).balance,
  });
  const delta = (a: Record<string, bigint>, b: Record<string, bigint>) => Object.fromEntries(Object.keys(a).map((k) => [k, formatAmount(b[k]! - a[k]!)]));
  const expectRejected = async (name: string, code: string, fn: () => Promise<unknown>) => {
    const before = await balances();
    try {
      await fn();
      trials.push({ name, expect: "rejected", pass: false, txHash: null, ledger: null, detail: "unexpectedly succeeded" });
    } catch (e) {
      const after = await balances();
      const unchanged = Object.keys(before).every((k) => before[k as keyof typeof before] === after[k as keyof typeof after]);
      const got = e instanceof ChainRejectedError ? e.contractError : String(e);
      trials.push({ name, expect: "rejected", pass: got === code && unchanged, txHash: e instanceof ChainRejectedError ? e.txHash : null, ledger: null, detail: `${got} at ${e instanceof ChainRejectedError ? e.stage : "?"}; balances unchanged: ${unchanged}` });
    }
  };
  const expectSuccess = async (name: string, fn: () => Promise<{ hash: string; ledger: number | null }>, check?: (d: Record<string, bigint>) => boolean) => {
    const before = await balances();
    const res = await fn();
    const after = await balances();
    const d = Object.fromEntries(Object.keys(before).map((k) => [k, after[k as keyof typeof after] - before[k as keyof typeof before]]));
    trials.push({ name, expect: "success", pass: check ? check(d) : true, txHash: res.hash, ledger: res.ledger, detail: "confirmed", balanceDelta: delta(before, after) });
  };

  await expectRejected("Fund before both parties accept", "WrongStatus", () => signed(buyer, "fund", [scv.address(buyer.publicKey()), scv.address(tokenId), scv.i128(total)]));
  await expectSuccess("Buyer accepts terms digest", () => signed(buyer, "accept_terms", [scv.address(buyer.publicKey()), scv.bytes32(termsHex)]));
  await expectRejected("Supplier accepts a different digest", "TermsDigestMismatch", () => signed(supplier, "accept_terms", [scv.address(supplier.publicKey()), scv.bytes32("ff".repeat(32))]));
  await expectSuccess("Supplier accepts terms digest", () => signed(supplier, "accept_terms", [scv.address(supplier.publicKey()), scv.bytes32(termsHex)]));
  await expectSuccess("Buyer funds escrow", () => signed(buyer, "fund", [scv.address(buyer.publicKey()), scv.address(tokenId), scv.i128(total)]), (d) => d.escrow === total && d.buyer === -total);

  const evidence = await evidenceDigest({ schema: "plimsoll.evidence.v1", dealId, milestoneOrdinal: 0, agreementDigest: termsHex, documents: [{ documentId: "doc", versionId: "v2", version: 2, documentType: "packing_list", sha256: "ab".repeat(32) }], findings: [], attestations: [] });
  await expectSuccess("Supplier anchors evidence bundle", () => signed(supplier, "anchor_evidence", [scv.address(supplier.publicKey()), scv.u32(0), scv.bytes32(evidence)]));
  await expectRejected("Release with zero approvals", "QuorumNotMet", () => gw.invokeAsRelayer({ contractId, method: "release_milestone", args: [scv.u32(0)] }));
  await expectSuccess("Buyer approves current evidence", () => signed(buyer, "approve_milestone", [scv.address(buyer.publicKey()), scv.u32(0), scv.bytes32(evidence)]));
  await expectRejected("Release with 1 of 2 approvals", "QuorumNotMet", () => gw.invokeAsRelayer({ contractId, method: "release_milestone", args: [scv.u32(0)] }));
  await expectRejected("Unappointed signer approves", "NotAppointedApprover", () => signed(resolver, "approve_milestone", [scv.address(resolver.publicKey()), scv.u32(0), scv.bytes32(evidence)]));
  await expectRejected("Inspector approves stale evidence digest", "EvidenceDigestMismatch", () => signed(inspector, "approve_milestone", [scv.address(inspector.publicKey()), scv.u32(0), scv.bytes32("cd".repeat(32))]));
  await expectSuccess("Inspector approves current evidence", () => signed(inspector, "approve_milestone", [scv.address(inspector.publicKey()), scv.u32(0), scv.bytes32(evidence)]));
  await expectSuccess("Permissionless release of milestone 0", () => gw.invokeAsRelayer({ contractId, method: "release_milestone", args: [scv.u32(0)] }), (d) => d.supplier === parseAmount("600") && d.escrow === -parseAmount("600"));
  await expectRejected("Replay release of milestone 0", "MilestoneNotOpen", () => gw.invokeAsRelayer({ contractId, method: "release_milestone", args: [scv.u32(0)] }));

  const reason = await disputeReasonDigest({ dealId, milestoneOrdinal: 1, reason: "Goods arrived damaged", openedBy: buyer.publicKey() });
  await expectSuccess("Buyer disputes milestone 1", () => signed(buyer, "open_dispute", [scv.address(buyer.publicKey()), scv.u32(1), scv.bytes32(reason)]));
  await expectRejected("Release disputed milestone", "MilestoneDisputed", () => gw.invokeAsRelayer({ contractId, method: "release_milestone", args: [scv.u32(1)] }));
  const split = (toBuyer: bigint, toPayee: bigint) => scv.struct({ to_buyer: scv.i128(toBuyer), to_payee: scv.i128(toPayee) });
  await expectRejected("Resolver over-allocates", "AllocationMismatch", () => signed(resolver, "resolve_dispute", [scv.address(resolver.publicKey()), scv.u32(1), split(parseAmount("400"), parseAmount("1"))]));
  await expectRejected("Buyer tries to resolve own dispute", "NotResolver", () => signed(buyer, "resolve_dispute", [scv.address(buyer.publicKey()), scv.u32(1), split(parseAmount("400"), 0n)]));
  await expectSuccess("Resolver splits 150 / 250", () => signed(resolver, "resolve_dispute", [scv.address(resolver.publicKey()), scv.u32(1), split(parseAmount("150"), parseAmount("250"))]), (d) => d.buyer === parseAmount("150") && d.supplier === parseAmount("250") && d.escrow === -parseAmount("400"));

  const snapshot = await gw.readSnapshot(contractId, asset);
  const conserved = conservationHolds(snapshot);
  const completed = snapshot.agreement.status === "Completed";
  trials.push({ name: "Final readback: Completed and funded = released + refunded + balance", expect: "success", pass: conserved && completed, txHash: null, ledger: snapshot.ledger, detail: `status=${snapshot.agreement.status} funded=${formatAmount(snapshot.agreement.funded)} released=${formatAmount(snapshot.agreement.released)} refunded=${formatAmount(snapshot.agreement.refunded)} balance=${formatAmount(snapshot.balance)}` });

  const receipt = {
    kind: "plimsoll.chain-verification.v1",
    network: network.id,
    passphrase: network.passphrase,
    escrowContractId: contractId,
    escrowExplorer: explorerUrl(network, "contract", contractId),
    wasmHash: required("PLIMSOLL_ESCROW_WASM_HASH"),
    token: { ...asset, contractId: tokenId, note: "Demo token (not USDC)" },
    dealId,
    termsDigest: termsHex,
    signers: { buyer: buyer.publicKey(), supplier: supplier.publicKey(), inspector: inspector.publicKey(), resolver: resolver.publicKey(), relayer: relayer.publicKey() },
    trials: trials.map((t) => ({ ...t, explorer: t.txHash ? explorerUrl(network, "tx", t.txHash) : null })),
    passed: trials.every((t) => t.pass),
    ranAt: new Date().toISOString(),
  };
  mkdirSync(resolve(ROOT, "evidence"), { recursive: true });
  const out = resolve(ROOT, `evidence/verify-${receipt.ranAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(out, JSON.stringify(receipt, null, 2));

  for (const t of trials) console.log(`${t.pass ? "PASS" : "FAIL"}  ${t.name.padEnd(62)} ${t.detail}${t.txHash ? `  ${t.txHash}` : ""}`);
  console.log(`\nReceipt: ${out}`);
  if (!receipt.passed) process.exit(1);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
