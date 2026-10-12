import { and, eq } from "drizzle-orm";
import { CANONICAL, billOfLadingSpec, commercialInvoiceSpec, packingListSpec, renderTradeDocument } from "@plimsoll/documents";
import { demoKeypair, isChainConfigured, network, type DemoPersonaKey } from "./chain";
import { db, schema } from "./db/client";
import { enqueue } from "./jobs";
import type { SessionContext } from "./auth/session";
import { prepareAction, submitAction, executePermissionless, type ActionInput } from "./services/actions";
import { createDraft, submitForAcceptance, type DraftInput } from "./services/deals";
import { uploadDocument, analyzeVersion } from "./services/documents";
import { prepareBundle } from "./services/evidence";
import { reconcileDeal } from "./services/reconcile";
import { syncDeal } from "./services/sync";

export const DEMO_PERSONAS: Record<DemoPersonaKey, { email: string; name: string; org: string; jurisdiction: string; title: string }> = {
  BUYER: { email: "buyer@demo.plimsoll.test", name: "Amara Okafor", org: CANONICAL.buyer, jurisdiction: "United Kingdom", title: "Head of Procurement" },
  SUPPLIER: { email: "supplier@demo.plimsoll.test", name: "Lin Wei", org: CANONICAL.supplier, jurisdiction: "China", title: "Export Manager" },
  INSPECTOR: { email: "inspector@demo.plimsoll.test", name: "Tomás Reyes", org: CANONICAL.inspector, jurisdiction: "Singapore", title: "Lead Inspector" },
  FORWARDER: { email: "forwarder@demo.plimsoll.test", name: "Priya Natarajan", org: CANONICAL.forwarder, jurisdiction: "China", title: "Operations Lead" },
  RESOLVER: { email: "resolver@demo.plimsoll.test", name: "Helena Brandt", org: CANONICAL.resolver, jurisdiction: "United Kingdom", title: "Appointed Resolver" },
};

/** Creates demo organizations, users and custodial testnet wallets once. Idempotent. */
export async function ensureDemoPersonas(): Promise<boolean> {
  if (!isChainConfigured()) return false;
  const net = network().id;
  for (const [key, p] of Object.entries(DEMO_PERSONAS) as [DemoPersonaKey, (typeof DEMO_PERSONAS)[DemoPersonaKey]][]) {
    const kp = demoKeypair(key);
    if (!kp) continue;
    const [existing] = await db().select().from(schema.users).where(eq(schema.users.email, p.email));
    if (existing) continue;
    await db().transaction(async (tx) => {
      const [org] = await tx.insert(schema.organizations).values({ legalName: p.org, displayName: p.org, jurisdiction: p.jurisdiction, verificationState: "sample_fixture" }).returning();
      const [user] = await tx.insert(schema.users).values({ email: p.email, displayName: p.name, isDemo: true, emailVerifiedAt: new Date(), emailNotifications: false }).returning();
      await tx.insert(schema.memberships).values({ orgId: org!.id, userId: user!.id, role: "owner" });
      await tx.insert(schema.wallets).values({ userId: user!.id, address: kp.publicKey(), network: net, accountKind: "demo_custodial", label: "Demo custody (testnet only)", verifiedAt: new Date() });
    });
  }
  return true;
}

export async function personaSession(key: DemoPersonaKey): Promise<SessionContext> {
  const [user] = await db().select().from(schema.users).where(eq(schema.users.email, DEMO_PERSONAS[key].email));
  if (!user) throw new Error(`Demo persona ${key} missing`);
  const [m] = await db().select({ org: schema.organizations, role: schema.memberships.role }).from(schema.memberships).innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.orgId)).where(eq(schema.memberships.userId, user.id));
  const wallets = await db().select().from(schema.wallets).where(eq(schema.wallets.userId, user.id));
  return { sessionId: "seed", method: "demo", user, org: m?.org ?? null, role: m?.role ?? null, wallets };
}

function sampleDraft(opts: { title: string; poNumber: string; supplierOrgId: string; scale: number }): DraftInput {
  const supplier = demoKeypair("SUPPLIER")!.publicKey();
  const s = opts.scale;
  const lines = CANONICAL.lines.map((l) => ({ sku: l.sku, description: l.description, quantity: Math.max(1, Math.round(l.quantity * s)), uom: l.uom, unitPrice: l.unitPrice }));
  const total = lines.reduce((a, l) => a + Math.round(Number(l.unitPrice) * 100) * l.quantity, 0);
  const pct = (p: number, last = false) => {
    const first = Math.round((total * 20) / 100);
    const second = Math.round((total * 60) / 100);
    const cents = last ? total - first - second : p === 20 ? first : second;
    return (cents / 100).toFixed(2);
  };
  return {
    title: opts.title,
    poNumber: opts.poNumber,
    supplier: { orgId: opts.supplierOrgId, legalName: CANONICAL.supplier, signingAddress: supplier, inviteEmail: null },
    lineItems: lines,
    incoterm: { rule: "FOB", namedPlace: CANONICAL.namedPlace },
    transportMode: "sea",
    originPort: CANONICAL.originPort,
    destinationPort: CANONICAL.destinationPort,
    governingLaw: "England and Wales",
    disputeForum: `Named resolver: ${CANONICAL.resolver}`,
    resolver: { name: CANONICAL.resolver, address: demoKeypair("RESOLVER")!.publicKey() },
    inspector: { name: CANONICAL.inspector, address: demoKeypair("INSPECTOR")!.publicKey() },
    forwarder: { name: CANONICAL.forwarder, address: demoKeypair("FORWARDER")!.publicKey() },
    fundingDeadlineDays: 14,
    tolerances: { quantityBps: 0, weightBps: 200 },
    milestones: [
      { name: "Purchase confirmed", condition: "Both parties signed the terms and escrow is fully funded; buyer releases the deposit.", amount: pct(20), approverRoles: ["buyer"], quorum: 1, refundAfterDays: 0, requiredDocuments: [] },
      { name: "Carrier handoff", condition: "Reconciled invoice, packing list and bill of lading copy, plus approval by the buyer and the appointed independent inspector.", amount: pct(60), approverRoles: ["buyer", "inspector"], quorum: 2, refundAfterDays: 0, requiredDocuments: ["commercial_invoice", "packing_list", "bill_of_lading"] },
      { name: "Receipt acknowledged", condition: "Buyer confirms receipt within 45 days; otherwise the named resolver decides. Unclaimed funds return to the buyer after 120 days.", amount: pct(20, true), approverRoles: ["buyer"], quorum: 1, refundAfterDays: 120, requiredDocuments: [] },
    ],
  };
}

async function act(session: SessionContext, dealId: string, input: ActionInput): Promise<true> {
  const prepared = await prepareAction(session, dealId, input);
  await submitAction(session, dealId, prepared.intentId, null);
  return true;
}

async function upload(session: SessionContext, dealId: string, type: "commercial_invoice" | "packing_list" | "bill_of_lading", fileName: string, bytes: Uint8Array): Promise<true> {
  const r = await uploadDocument(session, dealId, { documentType: type, documentId: null, fileName, bytes });
  await analyzeVersion(r.versionId);
  return true;
}

interface Scenario {
  title: string;
  poNumber: string;
  scale: number;
  /** The final state the scenario should rest in for the demo. */
  finish: "mismatch" | "dispute";
}

const SCENARIOS: Scenario[] = [
  { title: "Porcelain tile, Ningbo → Felixstowe", poNumber: CANONICAL.poNumber, scale: 1, finish: "mismatch" },
  { title: "Wall tile top-up order (dispute scenario)", poNumber: "PO-88240", scale: 0.05, finish: "dispute" },
];

async function sampleDeal(title: string) {
  const [d] = await db().select().from(schema.deals).where(and(eq(schema.deals.title, title), eq(schema.deals.isSample, true)));
  return d ?? null;
}

/**
 * Performs exactly one missing step of a scenario, decided from current database and ledger
 * state, so seeding can resume across short serverless invocations. Returns false when done.
 */
async function advance(sc: Scenario): Promise<boolean> {
  const buyer = await personaSession("BUYER");
  const supplier = await personaSession("SUPPLIER");
  const deal = await sampleDeal(sc.title);
  if (!deal) {
    const { id } = await createDraft(buyer, sampleDraft({ title: sc.title, poNumber: sc.poNumber, supplierOrgId: supplier.org!.id, scale: sc.scale }));
    await db().update(schema.deals).set({ isSample: true }).where(eq(schema.deals.id, id));
    return true;
  }
  const id = deal.id;
  if (deal.status === "draft") {
    await submitForAcceptance(buyer, id, deal.version);
    return true;
  }
  const snap = deal.chainSnapshot;
  if (!snap) return (await syncDeal(id)).status === "ok";
  const a = snap.agreement;
  if (!a.buyerAccepted) return act(buyer, id, { action: "accept_terms" });
  if (!a.supplierAccepted) return act(supplier, id, { action: "accept_terms" });
  if (a.status === "AwaitingFunding") return act(buyer, id, { action: "fund" });

  if (sc.finish === "dispute") {
    const m = snap.milestones[2];
    if (m?.status === "Open") return act(buyer, id, { action: "open_dispute", milestoneOrdinal: 2, reason: "Twelve cartons of KC-TILE-30 arrived cracked; photos and the surveyor note are attached to the claim. Buyer requests a partial refund of the receipt tranche." });
    return false;
  }

  const m0 = snap.milestones[0];
  if (m0?.status === "Open") {
    if (!m0.evidenceDigest) {
      await prepareBundle(buyer, id, 0);
      return act(buyer, id, { action: "anchor_evidence", milestoneOrdinal: 0 });
    }
    if (m0.approvals.length < m0.quorum) return act(buyer, id, { action: "approve_milestone", milestoneOrdinal: 0 });
    await executePermissionless(buyer, id, "release_milestone", 0);
    return true;
  }

  const forwarder = await personaSession("FORWARDER");
  const docs = await db().select({ type: schema.documents.documentType }).from(schema.documents).where(eq(schema.documents.dealId, id));
  const have = new Set(docs.map((d) => d.type));
  if (!have.has("commercial_invoice")) return upload(supplier, id, "commercial_invoice", "KC-INV-26-0917.pdf", await renderTradeDocument(commercialInvoiceSpec()));
  if (!have.has("packing_list")) return upload(supplier, id, "packing_list", "KC-PL-26-0917.pdf", await renderTradeDocument(packingListSpec(false)));
  if (!have.has("bill_of_lading")) {
    await upload(forwarder, id, "bill_of_lading", "MFPNGB2610447-copy.pdf", await renderTradeDocument(billOfLadingSpec()));
    await reconcileDeal(id);
    return true;
  }

  const [shipment] = await db().select().from(schema.shipments).where(eq(schema.shipments.dealId, id));
  const events = shipment ? await db().select({ id: schema.shipmentEvents.id }).from(schema.shipmentEvents).where(eq(schema.shipmentEvents.shipmentId, shipment.id)) : [];
  if (shipment && events.length === 0) {
    await db().update(schema.shipments).set({ vessel: CANONICAL.vessel, voyage: CANONICAL.voyage, carrierRef: CANONICAL.billNumber, bookingRef: "MFP-BK-88231", stage: "handed_to_carrier" }).where(eq(schema.shipments.id, shipment.id));
    await db().insert(schema.shipmentEvents).values([
      { shipmentId: shipment.id, eventCode: "BOOKED", description: "Space booked on MAERSK EDMONTON 441W", occurredAt: new Date("2026-09-28T08:00:00Z"), sourceType: "sample_fixture", sourceRef: "MFP-BK-88231", recordedBy: forwarder.user.id },
      { shipmentId: shipment.id, eventCode: "GATE_IN", description: `Containers ${CANONICAL.containers.join(", ")} gated in at Ningbo terminal`, occurredAt: new Date("2026-10-04T14:20:00Z"), sourceType: "sample_fixture", sourceRef: "synthetic-carrier-feed", recordedBy: forwarder.user.id },
      { shipmentId: shipment.id, eventCode: "LOADED", description: "Loaded on board; bill of lading copy issued", occurredAt: new Date("2026-10-06T02:10:00Z"), sourceType: "sample_fixture", sourceRef: CANONICAL.billNumber, recordedBy: forwarder.user.id },
    ]);
    return true;
  }
  return false;
}

/**
 * Builds the two judge scenarios with real testnet transactions, one step at a time until the
 * deadline. Returns true when both scenarios rest in their demo state.
 */
export async function seedSampleChain(deadline: number): Promise<boolean> {
  for (const sc of SCENARIOS) {
    while (await advance(sc)) {
      if (Date.now() > deadline) return false;
    }
  }
  return true;
}

/** Boot-time seeding: personas synchronously, chain scenarios as a background job. */
export async function ensureSeeded(): Promise<void> {
  if (!(await ensureDemoPersonas())) return;
  const [main] = await db().select({ id: schema.shipmentEvents.id }).from(schema.shipmentEvents).limit(1);
  const disputes = await db().select({ id: schema.disputes.id }).from(schema.disputes).limit(1);
  if (!main || disputes.length === 0) await enqueue(db(), "seed_sample_chain", {}, { dedupeKey: "seed_sample_chain" });
}
