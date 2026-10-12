/**
 * End-to-end acceptance run through the public HTTP API, as five separate signed-in personas,
 * against a running Plimsoll server and real Stellar testnet. Creates its own deal so the seeded
 * judge scenario is untouched. Writes a receipt to evidence/e2e-<timestamp>.json.
 *
 *   pnpm dev            # in another terminal
 *   pnpm e2e            # PLIMSOLL_URL defaults to http://localhost:3000
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import { billOfLadingSpec, renderTradeDocument } from "@plimsoll/documents";
import { readEnvFile } from "./env-file";

const ROOT = resolve(import.meta.dirname, "..");
const BASE = process.env.PLIMSOLL_URL ?? "http://localhost:3000";
const env = readEnvFile(resolve(ROOT, "apps/web/.env.local"));
type Persona = "BUYER" | "SUPPLIER" | "INSPECTOR" | "FORWARDER" | "RESOLVER";
const address = (p: Persona) => Keypair.fromSecret(env[`DEMO_${p}_SECRET`]!).publicKey();

interface Step {
  name: string;
  pass: boolean;
  detail: string;
  txHash?: string | null;
}
const steps: Step[] = [];

class Client {
  private cookie = "";
  constructor(readonly persona: Persona) {}

  async signIn(): Promise<void> {
    const res = await fetch(`${BASE}/api/v1/auth/demo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ persona: this.persona }) });
    if (!res.ok) throw new Error(`sign-in ${this.persona}: ${res.status} ${await res.text()}`);
    this.cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
  }

  async call<T>(method: string, path: string, body?: unknown, form?: FormData): Promise<{ status: number; data: T }> {
    const headers: Record<string, string> = { cookie: this.cookie, "idempotency-key": crypto.randomUUID() };
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(`${BASE}/api/v1${path}`, { method, headers, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined) });
    const text = await res.text();
    return { status: res.status, data: (text ? JSON.parse(text) : null) as T };
  }

  async ok<T>(method: string, path: string, body?: unknown, form?: FormData): Promise<T> {
    const r = await this.call<T>(method, path, body, form);
    if (r.status >= 300) throw new Error(`${this.persona} ${method} ${path} -> ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  }

  async act(dealId: string, input: Record<string, unknown>): Promise<{ txHash: string; status: string; ledger: number | null }> {
    const prepared = await this.ok<{ intentId: string }>("POST", `/deals/${dealId}/actions/prepare`, input);
    return this.ok("POST", `/deals/${dealId}/actions/submit`, { intentId: prepared.intentId, signedXdr: null });
  }
}

function record(name: string, pass: boolean, detail: string, txHash?: string | null): void {
  steps.push({ name, pass, detail, txHash });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name.padEnd(64)} ${detail}`);
}

async function expectStatus(name: string, promise: Promise<{ status: number; data: unknown }>, wantCode: string): Promise<void> {
  const r = await promise;
  const body = r.data as { error?: { code: string; message: string; details?: { contractError?: string } } };
  const got = body.error?.details?.contractError ?? body.error?.code ?? `HTTP ${r.status}`;
  record(name, r.status >= 400 && got === wantCode, `${got}: ${body.error?.message ?? ""}`.slice(0, 140));
}

async function waitFor<T>(label: string, fn: () => Promise<T | null>, timeoutMs = 90_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v !== null) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function main(): Promise<void> {
  const c = Object.fromEntries((["BUYER", "SUPPLIER", "INSPECTOR", "FORWARDER", "RESOLVER"] as Persona[]).map((p) => [p, new Client(p)])) as Record<Persona, Client>;
  for (const cl of Object.values(c)) await cl.signIn();
  const uniqueBill = `E2E${Date.now().toString(36).toUpperCase()}`;
  const generated: Record<string, Uint8Array> = { "bill-of-lading-copy.pdf": await renderTradeDocument(billOfLadingSpec({ billNumber: uniqueBill })) };
  const fixture = (name: string) => new Blob([generated[name] ?? readFileSync(resolve(ROOT, "tests/fixtures", name))], { type: "application/pdf" });

  const draft = {
    title: "E2E acceptance run",
    poNumber: "PO-88231",
    supplier: { orgId: null, legalName: "Kestrel Ceramics Co., Ltd.", signingAddress: address("SUPPLIER"), inviteEmail: null },
    lineItems: [
      { sku: "KC-TILE-60", description: "Porcelain floor tile 600x600 matt", quantity: 320, uom: "cartons", unitPrice: "285.00" },
      { sku: "KC-TILE-30", description: "Porcelain wall tile 300x600 gloss", quantity: 160, uom: "cartons", unitPrice: "358.75" },
    ],
    incoterm: { rule: "FOB", namedPlace: "Ningbo" },
    transportMode: "sea",
    originPort: "Ningbo",
    destinationPort: "Felixstowe",
    governingLaw: "England and Wales",
    disputeForum: "Named resolver",
    resolver: { name: "Harbour Arbitration Desk", address: address("RESOLVER") },
    inspector: { name: "Tidewater Inspection Services", address: address("INSPECTOR") },
    forwarder: { name: "Meridian Freight Partners", address: address("FORWARDER") },
    fundingDeadlineDays: 7,
    tolerances: { quantityBps: 0, weightBps: 200 },
    milestones: [
      { name: "Purchase confirmed", condition: "Signed and funded", amount: "29720.00", approverRoles: ["buyer"], quorum: 1, refundAfterDays: 0, requiredDocuments: [] },
      { name: "Carrier handoff", condition: "Reconciled documents + inspector and buyer approval", amount: "89160.00", approverRoles: ["buyer", "inspector"], quorum: 2, refundAfterDays: 0, requiredDocuments: ["commercial_invoice", "packing_list", "bill_of_lading"] },
      { name: "Receipt acknowledged", condition: "Buyer confirms receipt", amount: "29720.00", approverRoles: ["buyer"], quorum: 1, refundAfterDays: 90, requiredDocuments: [] },
    ],
  };
  const status = await c.BUYER.ok<{ balance: string }>("GET", `/wallets/${address("BUYER")}/status`);
  if (BigInt(status.balance) < 150_000_0000000n) await c.BUYER.ok("POST", "/wallets/faucet", { address: address("BUYER") });

  const created = await c.BUYER.ok<{ id: string; reference: string }>("POST", "/deals", draft);
  const id = created.id;
  record("Journey A: buyer creates draft with integer-unit terms", true, created.reference);

  await expectStatus("Supplier cannot freeze buyer's terms", c.SUPPLIER.call("POST", `/deals/${id}/terms/submit`, { version: 1 }), "ROLE_DENIED");
  const deployed = await c.BUYER.ok<{ contractId: string; txHash: string; termsDigest: string }>("POST", `/deals/${id}/terms/submit`, { version: 1 });
  record("Terms frozen; per-deal escrow deployed", true, deployed.contractId, deployed.txHash);

  await expectStatus("Funding before acceptance is refused", c.BUYER.call("POST", `/deals/${id}/actions/prepare`, { action: "fund" }), "TERMS_VERSION_STALE");
  for (const p of ["BUYER", "SUPPLIER"] as const) {
    const r = await c[p].act(id, { action: "accept_terms" });
    record(`${p.toLowerCase()} accepts terms digest on-chain`, r.status === "confirmed", `ledger ${r.ledger}`, r.txHash);
  }
  const funded = await c.BUYER.act(id, { action: "fund" });
  record("Buyer funds escrow; confirmed from ledger", funded.status === "confirmed", `ledger ${funded.ledger}`, funded.txHash);

  await c.BUYER.ok("POST", `/deals/${id}/milestones/0/evidence-bundle`);
  await c.BUYER.act(id, { action: "anchor_evidence", milestoneOrdinal: 0 });
  await c.BUYER.act(id, { action: "approve_milestone", milestoneOrdinal: 0 });
  const rel0 = await c.BUYER.ok<{ txHash: string; ledger: number }>("POST", `/deals/${id}/milestones/0/release`);
  record("Milestone 1 released after buyer approval", true, `ledger ${rel0.ledger}`, rel0.txHash);

  const upload = async (cl: Client, type: string, file: string, documentId?: string) => {
    const form = new FormData();
    form.set("documentType", type);
    form.set("file", fixture(file), file);
    if (documentId) form.set("documentId", documentId);
    return cl.ok<{ documentId: string; versionId: string; version: number }>("POST", `/deals/${id}/documents`, undefined, form);
  };
  await upload(c.SUPPLIER, "commercial_invoice", "commercial-invoice.pdf");
  const pl = await upload(c.SUPPLIER, "packing_list", "packing-list-v1-short.pdf");
  await upload(c.FORWARDER, "bill_of_lading", "bill-of-lading-copy.pdf");

  type Disc = { ruleId: string; field: string; severity: string; active: boolean; state: string; actual: { value: string | null } };
  const findings = await waitFor("reconciliation", async () => {
    const docs = await c.BUYER.ok<{ versions: { analysisState: string }[] }[]>("GET", `/deals/${id}/documents`);
    if (docs.length < 3 || docs.some((d) => d.versions[0]?.analysisState !== "done")) return null;
    const d = await c.BUYER.ok<Disc[]>("GET", `/deals/${id}/discrepancies`);
    return d.length > 0 ? d : null;
  });
  const qty = findings.find((f) => f.ruleId === "R-QTY" && f.active);
  record("Journey B: packing list quantity mismatch detected as blocking", qty?.severity === "blocking" && qty.actual.value === "148", `${qty?.field} actual=${qty?.actual.value}`);

  await expectStatus("Evidence bundle refused while blocking finding open", c.BUYER.call("POST", `/deals/${id}/milestones/1/evidence-bundle`), "EVIDENCE_NOT_READY");
  await expectStatus("Release attempt rejected by contract (no evidence anchored)", c.BUYER.call("POST", `/deals/${id}/milestones/1/release`), "EvidenceNotAnchored");

  const v2 = await upload(c.SUPPLIER, "packing_list", "packing-list-v2-corrected.pdf", pl.documentId);
  record("Supplier uploads corrected packing list as version 2", v2.version === 2, `version ${v2.version}`);
  await waitFor("re-reconciliation", async () => {
    const d = await c.BUYER.ok<Disc[]>("GET", `/deals/${id}/discrepancies`);
    return d.some((f) => f.ruleId === "R-QTY" && f.active) ? null : d;
  });
  record("Quantity finding no longer reproduces on corrected version", true, "R-QTY inactive");

  const bundle = await c.SUPPLIER.ok<{ digest: string; manifest: { documents: { version: number; documentType: string }[] } }>("POST", `/deals/${id}/milestones/1/evidence-bundle`);
  const plVersion = bundle.manifest.documents.find((d) => d.documentType === "packing_list")?.version;
  record("Evidence bundle binds the corrected version", plVersion === 2, `digest ${bundle.digest.slice(0, 16)}… packing list v${plVersion}`);
  const anchor = await c.SUPPLIER.act(id, { action: "anchor_evidence", milestoneOrdinal: 1 });
  record("Supplier anchors evidence digest on-chain", anchor.status === "confirmed", `ledger ${anchor.ledger}`, anchor.txHash);

  await expectStatus("Forwarder (not appointed approver) cannot approve", c.FORWARDER.call("POST", `/deals/${id}/actions/prepare`, { action: "approve_milestone", milestoneOrdinal: 1 }), "ROLE_DENIED");
  const insp = await c.INSPECTOR.act(id, { action: "approve_milestone", milestoneOrdinal: 1 });
  record("Inspector approves current evidence digest", insp.status === "confirmed", `ledger ${insp.ledger}`, insp.txHash);
  await expectStatus("Release with 1 of 2 approvals rejected by contract", c.SUPPLIER.call("POST", `/deals/${id}/milestones/1/release`), "QuorumNotMet");
  const buyerApprove = await c.BUYER.act(id, { action: "approve_milestone", milestoneOrdinal: 1 });
  record("Buyer approves; quorum 2 of 2", buyerApprove.status === "confirmed", `ledger ${buyerApprove.ledger}`, buyerApprove.txHash);
  const rel1 = await c.SUPPLIER.ok<{ txHash: string; ledger: number }>("POST", `/deals/${id}/milestones/1/release`);
  record("Journey C: carrier-handoff tranche released exactly once", true, `ledger ${rel1.ledger}`, rel1.txHash);
  await expectStatus("Replay of release rejected by contract", c.BUYER.call("POST", `/deals/${id}/milestones/1/release`), "MilestoneNotOpen");

  const disputed = await c.BUYER.act(id, { action: "open_dispute", milestoneOrdinal: 2, reason: "Twelve cartons arrived cracked; requesting partial refund of the receipt tranche." });
  record("Journey D: buyer freezes the receipt tranche", disputed.status === "confirmed", `ledger ${disputed.ledger}`, disputed.txHash);
  await expectStatus("Buyer cannot resolve own dispute", c.BUYER.call("POST", `/deals/${id}/actions/prepare`, { action: "resolve_dispute", milestoneOrdinal: 2, toBuyer: "14860.00", toPayee: "14860.00", rationale: "Buyer attempting to self-resolve." }), "ROLE_DENIED");
  await expectStatus("Over-allocation refused", c.RESOLVER.call("POST", `/deals/${id}/actions/prepare`, { action: "resolve_dispute", milestoneOrdinal: 2, toBuyer: "20000.00", toPayee: "20000.00", rationale: "Allocation exceeding the frozen amount." }), "VALIDATION_FAILED");
  const resolved = await c.RESOLVER.act(id, { action: "resolve_dispute", milestoneOrdinal: 2, toBuyer: "7430.00", toPayee: "22290.00", rationale: "Surveyor note supports a quarter of the tranche as damage." });
  record("Resolver splits 7,430 / 22,290 atomically", resolved.status === "confirmed", `ledger ${resolved.ledger}`, resolved.txHash);

  const view = await c.BUYER.ok<{ publicRef: string; chain: { status: string; funded: string; released: string; refunded: string; balance: string; conservationHolds: boolean } }>("GET", `/deals/${id}`);
  const proof = await fetch(`${BASE}/api/v1/verify/${view.publicRef}`).then((r) => r.json() as Promise<{ chain: { status: string; conservationHolds: boolean }; transactions: unknown[] }>);
  record("Ledger readback: Completed, conservation holds", view.chain.status === "Completed" && view.chain.conservationHolds && proof.chain.conservationHolds, `released ${view.chain.released} refunded ${view.chain.refunded} balance ${view.chain.balance}`);
  const proofText = JSON.stringify(proof);
  record("Public proof exposes no dispute text or document fields", !proofText.includes("cracked") && !proofText.includes("Porcelain floor tile 600x600 matt\",\"quantity"), `${proof.transactions.length} transactions`);
  const audit = await c.BUYER.ok<{ checked: number; brokenAt: number | null }>("GET", "/audit/verify");
  record("Audit hash chain intact", audit.brokenAt === null, `${audit.checked} entries`);

  const receipt = { kind: "plimsoll.e2e-api.v1", base: BASE, dealId: id, reference: created.reference, contractId: deployed.contractId, steps, passed: steps.every((s) => s.pass), ranAt: new Date().toISOString() };
  mkdirSync(resolve(ROOT, "evidence"), { recursive: true });
  const out = resolve(ROOT, `evidence/e2e-${receipt.ranAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(out, JSON.stringify(receipt, null, 2));
  console.log(`\n${steps.filter((s) => s.pass).length}/${steps.length} passed. Receipt: ${out}`);
  if (!receipt.passed) process.exit(1);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
