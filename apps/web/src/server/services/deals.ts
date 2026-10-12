import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  DOCUMENT_TYPES,
  INCOTERM_RULES,
  dealIdDigest,
  parseAmount,
  termsDigest,
  validateTerms,
  type DealTerms,
  type TermsApprover,
} from "@plimsoll/domain";
import { constructorArgs } from "@plimsoll/stellar";
import { appendAudit } from "../audit";
import { gateway, network } from "../chain";
import { db, schema, type Tx } from "../db/client";
import { chainConfig } from "../env";
import { ApiError } from "../http";
import { enqueue } from "../jobs";
import { assertDeployQuota } from "../quotas";
import type { SessionContext } from "../auth/session";
import { dealAccess, requireRole, visibleDealIds, type DealAccess } from "./access";
import { assertEmailVerified } from "./email-verification";
import { notifyParticipants } from "./notify";

const address = z.string().regex(/^G[A-Z2-7]{55}$/, "Must be a Stellar account address (G…)");
const amount = z.string().regex(/^\d{1,15}(\.\d{1,7})?$/, "Use a plain decimal amount, e.g. 29720.00");

export const draftInput = z.object({
  title: z.string().min(3).max(120),
  poNumber: z.string().min(1).max(40),
  supplier: z.object({ orgId: z.uuid().nullable(), legalName: z.string().min(2), signingAddress: address.nullable(), inviteEmail: z.email().nullable() }),
  lineItems: z.array(z.object({ sku: z.string().min(1).max(40), description: z.string().min(1).max(200), quantity: z.number().int().positive(), uom: z.string().min(1).max(20), unitPrice: amount })).min(1).max(50),
  incoterm: z.object({ rule: z.enum(INCOTERM_RULES), namedPlace: z.string().min(2) }),
  transportMode: z.enum(["sea", "air", "road", "rail"]),
  originPort: z.string().min(2),
  destinationPort: z.string().min(2),
  governingLaw: z.string().min(2),
  disputeForum: z.string().min(2),
  resolver: z.object({ name: z.string().min(2), address }),
  inspector: z.object({ name: z.string().min(2), address }).nullable(),
  forwarder: z.object({ name: z.string().min(2), address }).nullable(),
  fundingDeadlineDays: z.number().int().min(1).max(365),
  tolerances: z.object({ quantityBps: z.number().int().min(0).max(2000), weightBps: z.number().int().min(0).max(2000) }),
  milestones: z
    .array(
      z.object({
        name: z.string().min(2).max(80),
        condition: z.string().min(2).max(400),
        amount,
        approverRoles: z.array(z.enum(["buyer", "supplier", "inspector", "forwarder"])).min(1),
        quorum: z.number().int().min(1),
        refundAfterDays: z.number().int().min(0).max(730),
        requiredDocuments: z.array(z.enum(DOCUMENT_TYPES)),
      }),
    )
    .min(1)
    .max(12),
});
export type DraftInput = z.infer<typeof draftInput>;

function newPublicRef(): string {
  return randomBytes(9).toString("base64url");
}

async function nextReference(tx: Tx): Promise<string> {
  const rows = await tx.select({ reference: schema.deals.reference }).from(schema.deals);
  const max = rows.reduce((m, r) => Math.max(m, Number(/PL-(\d+)/.exec(r.reference)?.[1] ?? 0)), 2047);
  return `PL-${max + 1}`;
}

function buyerWallet(session: SessionContext): string {
  const w = session.wallets.find((x) => x.network === network().id);
  if (!w) throw new ApiError("WALLET_REQUIRED", "Connect a Stellar wallet on this network before creating a deal.");
  return w.address;
}

/** Builds canonical terms from wizard input. Amounts become integer token units here, once. */
export function buildTerms(input: DraftInput, ctx: { dealId: string; reference: string; buyerOrg: { id: string; legalName: string }; buyerAddress: string; supplierOrgId: string }): DealTerms {
  const cfg = chainConfig();
  const lineItems = input.lineItems.map((li) => {
    const unit = parseAmount(li.unitPrice);
    return { sku: li.sku, description: li.description, quantity: li.quantity, uom: li.uom, unitPriceUnits: String(unit), totalUnits: String(unit * BigInt(li.quantity)) };
  });
  const total = lineItems.reduce((a, li) => a + BigInt(li.totalUnits), 0n);
  const supplierAddress = input.supplier.signingAddress ?? "";
  const roleAddress: Record<TermsApprover["role"], { address: string; name: string } | null> = {
    buyer: { address: ctx.buyerAddress, name: ctx.buyerOrg.legalName },
    supplier: { address: supplierAddress, name: input.supplier.legalName },
    inspector: input.inspector,
    forwarder: input.forwarder,
  };
  const now = Math.floor(Date.now() / 1000);

  return {
    schema: "plimsoll.terms.v1",
    dealId: ctx.dealId,
    reference: ctx.reference,
    poNumber: input.poNumber,
    network: network().id,
    asset: { code: cfg.asset.code, issuer: cfg.asset.issuer, contractId: cfg.asset.contractId, currency: "USD" },
    buyer: { orgId: ctx.buyerOrg.id, legalName: ctx.buyerOrg.legalName, address: ctx.buyerAddress },
    supplier: { orgId: ctx.supplierOrgId, legalName: input.supplier.legalName, address: supplierAddress },
    resolver: input.resolver,
    goods: { lineItems, incoterm: { ...input.incoterm, edition: "Incoterms® 2020" }, transportMode: input.transportMode, originPort: input.originPort, destinationPort: input.destinationPort },
    governingLaw: input.governingLaw,
    disputeForum: input.disputeForum,
    totalUnits: String(total),
    fundingDeadline: now + input.fundingDeadlineDays * 86_400,
    tolerances: input.tolerances,
    milestones: input.milestones.map((m, i) => ({
      ordinal: i,
      name: m.name,
      condition: m.condition,
      amountUnits: String(parseAmount(m.amount)),
      payee: supplierAddress,
      approvers: m.approverRoles.map((role) => {
        const who = roleAddress[role];
        if (!who) throw new ApiError("VALIDATION_FAILED", `Milestone "${m.name}" names a ${role} approver but no ${role} is appointed.`);
        return { role, address: who.address, name: who.name };
      }),
      quorum: m.quorum,
      refundAfter: m.refundAfterDays > 0 ? now + m.refundAfterDays * 86_400 : 0,
      requiredDocuments: m.requiredDocuments,
    })),
  };
}

async function ensureSupplierOrg(tx: Tx, input: DraftInput): Promise<string> {
  if (input.supplier.orgId) {
    const [org] = await tx.select().from(schema.organizations).where(eq(schema.organizations.id, input.supplier.orgId));
    if (!org) throw new ApiError("VALIDATION_FAILED", "Unknown supplier organization.");
    return org.id;
  }
  if (input.supplier.signingAddress) {
    const [known] = await tx
      .select({ orgId: schema.memberships.orgId })
      .from(schema.wallets)
      .innerJoin(schema.memberships, and(eq(schema.memberships.userId, schema.wallets.userId), eq(schema.memberships.status, "active")))
      .where(eq(schema.wallets.address, input.supplier.signingAddress))
      .limit(1);
    if (known) return known.orgId;
  }
  const [org] = await tx.insert(schema.organizations).values({ legalName: input.supplier.legalName, displayName: input.supplier.legalName, jurisdiction: "Unspecified" }).returning();
  return org!.id;
}

async function writeParticipants(tx: Tx, dealId: string, terms: DealTerms, input: DraftInput, session: SessionContext): Promise<string | null> {
  const [previous] = await tx.select().from(schema.dealParticipants).where(and(eq(schema.dealParticipants.dealId, dealId), eq(schema.dealParticipants.role, "supplier")));
  await tx.delete(schema.dealParticipants).where(eq(schema.dealParticipants.dealId, dealId));
  let inviteToken: string | null = null;
  const supplierInvite = input.supplier.inviteEmail && !input.supplier.signingAddress;
  // Editing a draft must not invalidate a link already emailed to the same supplier address.
  const keepInvite =
    supplierInvite && previous?.status === "invited" && previous.inviteTokenHash && previous.inviteEmail?.toLowerCase() === input.supplier.inviteEmail?.toLowerCase() && (previous.inviteExpiresAt?.getTime() ?? 0) > Date.now();
  if (supplierInvite && !keepInvite) inviteToken = randomBytes(24).toString("base64url");
  const rows: (typeof schema.dealParticipants.$inferInsert)[] = [
    { dealId, orgId: terms.buyer.orgId, userId: session.user.id, role: "buyer", displayName: terms.buyer.legalName, signingAddress: terms.buyer.address },
    {
      dealId,
      orgId: terms.supplier.orgId,
      role: "supplier",
      displayName: terms.supplier.legalName,
      signingAddress: terms.supplier.address || null,
      inviteEmail: input.supplier.inviteEmail,
      inviteTokenHash: keepInvite ? previous!.inviteTokenHash : inviteToken ? createHash("sha256").update(inviteToken).digest("hex") : null,
      inviteExpiresAt: keepInvite ? previous!.inviteExpiresAt : inviteToken ? new Date(Date.now() + 14 * 86_400_000) : null,
      status: supplierInvite ? "invited" : "active",
    },
    { dealId, role: "resolver", displayName: input.resolver.name, signingAddress: input.resolver.address },
  ];
  if (input.inspector) rows.push({ dealId, role: "inspector", displayName: input.inspector.name, signingAddress: input.inspector.address });
  if (input.forwarder) rows.push({ dealId, role: "forwarder", displayName: input.forwarder.name, signingAddress: input.forwarder.address });
  await tx.insert(schema.dealParticipants).values(rows);
  await linkWalletOwners(tx, dealId);
  return inviteToken;
}

/** Participants whose signing address belongs to a known user wallet are linked to that user. */
export async function linkWalletOwners(tx: Tx, dealId: string): Promise<void> {
  const parts = await tx.select().from(schema.dealParticipants).where(eq(schema.dealParticipants.dealId, dealId));
  const addrs = parts.map((p) => p.signingAddress).filter((a): a is string => Boolean(a));
  if (addrs.length === 0) return;
  const owners = await tx.select().from(schema.wallets).where(inArray(schema.wallets.address, addrs));
  const ownerIds = owners.map((w) => w.userId);
  const memberships = ownerIds.length ? await tx.select().from(schema.memberships).where(and(inArray(schema.memberships.userId, ownerIds), eq(schema.memberships.status, "active"))) : [];
  for (const p of parts) {
    const owner = owners.find((w) => w.address === p.signingAddress);
    if (!owner || (p.userId && p.orgId)) continue;
    const orgId = p.orgId ?? memberships.find((m) => m.userId === owner.userId)?.orgId ?? null;
    await tx.update(schema.dealParticipants).set({ userId: p.userId ?? owner.userId, orgId }).where(eq(schema.dealParticipants.id, p.id));
  }
}

async function writeMilestonesAndShipment(tx: Tx, dealId: string, terms: DealTerms): Promise<void> {
  await tx.delete(schema.milestones).where(eq(schema.milestones.dealId, dealId));
  await tx.insert(schema.milestones).values(terms.milestones.map((m) => ({ dealId, ordinal: m.ordinal, name: m.name, amountUnits: BigInt(m.amountUnits), requiredDocuments: m.requiredDocuments })));
  const shipment = {
    transportMode: terms.goods.transportMode,
    incoterm: terms.goods.incoterm.rule,
    namedPlace: terms.goods.incoterm.namedPlace,
    originPort: terms.goods.originPort,
    destinationPort: terms.goods.destinationPort,
  };
  await tx.insert(schema.shipments).values({ dealId, ...shipment }).onConflictDoUpdate({ target: schema.shipments.dealId, set: shipment });
}

export async function createDraft(session: SessionContext, input: DraftInput): Promise<{ id: string; reference: string; inviteToken: string | null }> {
  if (!session.org) throw new ApiError("ROLE_DENIED", "Select an organization first.");
  assertEmailVerified(session);
  const org = session.org;
  const buyerAddress = buyerWallet(session);
  return db().transaction(async (tx) => {
    const reference = await nextReference(tx);
    const supplierOrgId = await ensureSupplierOrg(tx, input);
    const [row] = await tx
      .insert(schema.deals)
      .values({ reference, publicRef: newPublicRef(), buyerOrgId: org.id, supplierOrgId, title: input.title, chainNetwork: network().id, terms: {} as DealTerms, createdBy: session.user.id })
      .returning();
    const terms = buildTerms(input, { dealId: row!.id, reference, buyerOrg: org, buyerAddress, supplierOrgId });
    await tx.update(schema.deals).set({ terms }).where(eq(schema.deals.id, row!.id));
    const inviteToken = await writeParticipants(tx, row!.id, terms, input, session);
    await writeMilestonesAndShipment(tx, row!.id, terms);
    await appendAudit(tx, { orgId: org.id, dealId: row!.id, actorUserId: session.user.id, actorLabel: session.user.displayName, resourceType: "deal", resourceId: row!.id, action: "deal.draft_created", evidence: { reference, totalUnits: terms.totalUnits } });
    return { id: row!.id, reference, inviteToken };
  });
}

export async function updateDraft(session: SessionContext, dealId: string, expectedVersion: number, input: DraftInput): Promise<{ version: number; inviteToken: string | null }> {
  const access = await dealAccess(session, dealId);
  requireRole(access, "buyer");
  if (access.deal.status !== "draft") throw new ApiError("TERMS_VERSION_STALE", "Only drafts can be edited. Propose an amendment instead.");
  if (access.deal.version !== expectedVersion) throw new ApiError("TERMS_VERSION_STALE", "This draft changed since you loaded it. Reload to see the latest version.");
  const buyerAddress = buyerWallet(session);
  return db().transaction(async (tx) => {
    const supplierOrgId = await ensureSupplierOrg(tx, input);
    const terms = buildTerms(input, { dealId, reference: access.deal.reference, buyerOrg: session.org!, buyerAddress, supplierOrgId });
    const version = access.deal.version + 1;
    await tx.update(schema.deals).set({ terms, title: input.title, supplierOrgId, version, updatedAt: new Date() }).where(eq(schema.deals.id, dealId));
    const inviteToken = await writeParticipants(tx, dealId, terms, input, session);
    await writeMilestonesAndShipment(tx, dealId, terms);
    await appendAudit(tx, { orgId: session.org!.id, dealId, actorUserId: session.user.id, actorLabel: session.user.displayName, resourceType: "deal", resourceId: dealId, action: "deal.draft_updated", evidence: { version } });
    return { version, inviteToken };
  });
}

/**
 * Freezes the terms, derives the digest both parties will sign, and deploys this deal's escrow
 * with those exact terms as constructor arguments. Nothing about economics can change after this
 * without a bilateral amendment that redeploys.
 */
export async function submitForAcceptance(session: SessionContext, dealId: string, expectedVersion: number): Promise<{ contractId: string; txHash: string; termsDigest: string }> {
  assertEmailVerified(session);
  const access = await dealAccess(session, dealId);
  requireRole(access, "buyer");
  const deal = access.deal;
  if (deal.status !== "draft") throw new ApiError("TERMS_VERSION_STALE", "Terms were already submitted.");
  if (deal.version !== expectedVersion) throw new ApiError("TERMS_VERSION_STALE", "This draft changed since you reviewed it.");
  const terms = deal.terms;
  if (!terms.supplier.address) throw new ApiError("VALIDATION_FAILED", "The supplier has not registered a signing address yet.");
  const issues = validateTerms(terms);
  if (issues.length > 0) throw new ApiError("VALIDATION_FAILED", "Terms are not internally consistent.", issues);

  await assertDeployQuota(session);
  const digest = await termsDigest(terms);
  const dealHex = await dealIdDigest(`${deal.id}:v${deal.version}`);
  const cfg = chainConfig();
  const deployed = await gateway().deployEscrow({ wasmHash: cfg.wasmHash, constructorArgs: constructorArgs(terms, dealHex, digest), salt: Buffer.from(dealHex, "hex") });

  await db().transaction(async (tx) => {
    await tx
      .update(schema.deals)
      .set({ status: "awaiting_acceptance", termsDigest: digest, dealIdHex: dealHex, escrowContractId: deployed.contractId, deployTxHash: deployed.hash, updatedAt: new Date() })
      .where(eq(schema.deals.id, dealId));
    await tx.insert(schema.chainTransactions).values({ dealId, kind: "deploy", actorAddress: gateway().relayerAddress, actorUserId: session.user.id, network: network().id, txHash: deployed.hash, status: "confirmed", ledger: deployed.ledger, confirmedAt: new Date(), payload: { contractId: deployed.contractId, wasmHash: cfg.wasmHash, termsDigest: digest } });
    await appendAudit(tx, { orgId: session.org?.id, dealId, actorUserId: session.user.id, actorLabel: session.user.displayName, resourceType: "deal", resourceId: dealId, action: "deal.escrow_deployed", source: "chain", evidence: { contractId: deployed.contractId, txHash: deployed.hash, termsDigest: digest } });
    await enqueue(tx, "sync_deal", { dealId }, { dedupeKey: `sync:${dealId}` });
  });
  await notifyParticipants(dealId, { kind: "terms.ready", title: `${deal.reference}: terms ready for signature`, body: `Review and accept terms digest ${digest.slice(0, 12)}… on-chain.`, path: `/deals/${dealId}` }, session.user.id);
  return { contractId: deployed.contractId, txHash: deployed.hash, termsDigest: digest };
}

/** Sends an accepted-but-unfunded deal back to draft. The old escrow must be cancelled on-chain first. */
export async function reopenForAmendment(session: SessionContext, dealId: string): Promise<void> {
  const access = await dealAccess(session, dealId);
  requireRole(access, "buyer", "supplier");
  const snap = access.deal.chainSnapshot;
  if (access.deal.status !== "cancelled" || !snap || snap.agreement.status !== "Cancelled") {
    throw new ApiError("RECONCILIATION_REQUIRED", "Cancel the unfunded escrow on-chain before amending; terms in a live contract cannot be edited.");
  }
  await db().transaction(async (tx) => {
    await tx.update(schema.deals).set({ status: "draft", version: access.deal.version + 1, termsDigest: null, dealIdHex: null, escrowContractId: null, deployTxHash: null, chainSnapshot: null, chainSyncStatus: "never", updatedAt: new Date() }).where(eq(schema.deals.id, dealId));
    await appendAudit(tx, { orgId: session.org?.id, dealId, actorUserId: session.user.id, actorLabel: session.user.displayName, resourceType: "deal", resourceId: dealId, action: "deal.amendment_opened", evidence: { previousContract: access.deal.escrowContractId ?? "" } });
  });
}

export async function listDeals(session: SessionContext) {
  const ids = await visibleDealIds(session);
  if (ids.length === 0) return [];
  return db().select().from(schema.deals).where(inArray(schema.deals.id, ids)).orderBy(desc(schema.deals.updatedAt));
}

export async function dealTransactions(dealId: string) {
  return db().select().from(schema.chainTransactions).where(and(eq(schema.chainTransactions.dealId, dealId))).orderBy(desc(schema.chainTransactions.createdAt));
}

export type { DealAccess };
