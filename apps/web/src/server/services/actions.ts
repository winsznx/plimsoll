import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Transaction, xdr } from "@stellar/stellar-sdk";
import { disputeReasonDigest, formatAmount, parseAmount, type ChainMilestone, type ChainSnapshot } from "@plimsoll/domain";
import { assertSponsorable, isChainRejected, hasTrustline, scv, transactionFromXdr, type SponsoredMethod } from "@plimsoll/stellar";
import { appendAudit } from "../audit";
import { custodialKeypairFor, gateway, network } from "../chain";
import { db, schema } from "../db/client";
import type { ChainTxKind } from "../db/schema";
import { ApiError } from "../http";
import { enqueue } from "../jobs";
import { assertSponsorQuota } from "../quotas";
import type { SessionContext } from "../auth/session";
import { dealAccess, participantName, type DealAccess } from "./access";
import { loadSnapshot } from "./snapshot";
import { syncDeal } from "./sync";

export const actionInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept_terms") }),
  z.object({ action: z.literal("fund") }),
  z.object({ action: z.literal("cancel_unfunded") }),
  z.object({ action: z.literal("anchor_evidence"), milestoneOrdinal: z.number().int().min(0) }),
  z.object({ action: z.literal("approve_milestone"), milestoneOrdinal: z.number().int().min(0) }),
  z.object({ action: z.literal("revoke_approval"), milestoneOrdinal: z.number().int().min(0) }),
  z.object({ action: z.literal("open_dispute"), milestoneOrdinal: z.number().int().min(0), reason: z.string().min(10).max(2000) }),
  z.object({
    action: z.literal("resolve_dispute"),
    milestoneOrdinal: z.number().int().min(0),
    toBuyer: z.string().regex(/^\d{1,15}(\.\d{1,7})?$/),
    toPayee: z.string().regex(/^\d{1,15}(\.\d{1,7})?$/),
    rationale: z.string().min(10).max(4000),
  }),
]);
export type ActionInput = z.infer<typeof actionInput>;

const KIND: Record<SponsoredMethod, ChainTxKind> = {
  accept_terms: "accept",
  fund: "fund",
  anchor_evidence: "anchor",
  approve_milestone: "approve",
  revoke_approval: "revoke",
  open_dispute: "dispute",
  resolve_dispute: "resolve",
  cancel_unfunded: "cancel",
};

export interface ActionReview {
  title: string;
  /** Plain statements of what becomes true on-chain if this is signed. */
  consequences: string[];
  network: string;
  contractId: string;
  method: string;
  signer: string;
  signerName: string;
  amountUnits: string | null;
}

export interface PreparedAction {
  intentId: string;
  signing: "demo_custodial" | "wallet";
  xdr: string | null;
  networkPassphrase: string;
  review: ActionReview;
}

const INTENT_TTL_MS = 4 * 60 * 1000;

async function freshSnapshot(access: DealAccess): Promise<ChainSnapshot> {
  if (!access.deal.escrowContractId) throw new ApiError("RECONCILIATION_REQUIRED", "This deal has no deployed escrow yet.");
  const outcome = await syncDeal(access.deal.id);
  if (outcome.status === "unavailable") throw new ApiError("RPC_UNAVAILABLE", "Stellar RPC is unavailable; signing is paused until on-chain state can be read.");
  const [deal] = await db().select().from(schema.deals).where(eq(schema.deals.id, access.deal.id));
  return loadSnapshot(deal!.chainSnapshot!);
}

function pickSigner(access: DealAccess, candidates: string[], roleLabel: string): string {
  const signer = access.addresses.find((a) => candidates.includes(a));
  if (!signer) throw new ApiError("ROLE_DENIED", `You do not control the signing address for the ${roleLabel} role on this deal.`);
  return signer;
}

function milestoneOf(snap: ChainSnapshot, ordinal: number): ChainMilestone {
  const m = snap.milestones.find((x) => x.id === ordinal);
  if (!m) throw new ApiError("NOT_FOUND", "Milestone not found.");
  return m;
}

interface Plan {
  method: SponsoredMethod;
  signer: string;
  args: xdr.ScVal[];
  title: string;
  consequences: string[];
  amountUnits: bigint | null;
  milestoneOrdinal: number | null;
  payload: Record<string, unknown>;
}

async function plan(access: DealAccess, snap: ChainSnapshot, input: ActionInput): Promise<Plan> {
  const a = snap.agreement;
  const terms = access.deal.terms;
  const asset = terms.asset.code;
  const names = (addr: string) => participantName(access.participants, addr);

  switch (input.action) {
    case "accept_terms": {
      const signer = pickSigner(access, [a.buyer, a.supplier], "buyer or supplier");
      if (a.status !== "AwaitingAcceptance") throw new ApiError("TERMS_VERSION_STALE", "Terms are no longer awaiting acceptance.");
      if ((signer === a.buyer && a.buyerAccepted) || (signer === a.supplier && a.supplierAccepted)) throw new ApiError("ALREADY_SETTLED", "You already accepted these terms.");
      const payees = [...new Set(snap.milestones.map((m) => m.payee))];
      for (const p of payees) {
        if (!(await hasTrustline(gateway(), p, terms.asset))) throw new ApiError("TRUSTLINE_MISSING", `Payee ${names(p)} has no ${asset} trustline, so releases to it would fail. Add the trustline first.`, { account: p, asset });
      }
      return {
        method: "accept_terms",
        signer,
        args: [scv.address(signer), scv.bytes32(a.termsDigest)],
        title: `Accept terms ${terms.reference} as ${signer === a.buyer ? "buyer" : "supplier"}`,
        consequences: [
          `Binds your signature to terms digest ${a.termsDigest}.`,
          `Total ${formatAmount(a.total)} ${asset} across ${a.milestoneCount} milestones; payees, approvers, quorum and resolver are fixed in contract ${snap.contractId}.`,
          "Economic terms can only change afterwards by cancelling before funding and re-issuing new terms that both parties sign.",
        ],
        amountUnits: null,
        milestoneOrdinal: null,
        payload: { termsDigest: a.termsDigest },
      };
    }
    case "fund": {
      const signer = pickSigner(access, [a.buyer], "buyer");
      if (a.status !== "AwaitingFunding") throw new ApiError("TERMS_VERSION_STALE", a.status === "AwaitingAcceptance" ? "Both parties must accept the terms before funding." : "The escrow is not awaiting funding.");
      const remaining = a.total - a.funded;
      return {
        method: "fund",
        signer,
        args: [scv.address(signer), scv.address(terms.asset.contractId), scv.i128(remaining)],
        title: `Fund escrow with ${formatAmount(remaining)} ${asset}`,
        consequences: [
          `Moves ${formatAmount(remaining)} ${asset} from ${names(signer)} into escrow contract ${snap.contractId}.`,
          `Escrow becomes fully funded at ${formatAmount(a.total)}; funds leave only through milestone release, resolver allocation or a predeclared refund.`,
          `Asset is fixed: ${asset} issued by ${terms.asset.issuer} (contract ${terms.asset.contractId}).`,
        ],
        amountUnits: remaining,
        milestoneOrdinal: null,
        payload: { remainingUnits: String(remaining) },
      };
    }
    case "cancel_unfunded": {
      const signer = pickSigner(access, [a.buyer, a.supplier], "buyer or supplier");
      return {
        method: "cancel_unfunded",
        signer,
        args: [scv.address(signer)],
        title: `Cancel unfunded agreement ${terms.reference}`,
        consequences: [a.funded > 0n ? `Returns the partial deposit of ${formatAmount(a.funded)} ${asset} to the buyer.` : "No funds are held; the contract becomes permanently cancelled.", "New terms will require a new escrow deployment and fresh signatures."],
        amountUnits: a.funded,
        milestoneOrdinal: null,
        payload: {},
      };
    }
    case "anchor_evidence": {
      const m = milestoneOf(snap, input.milestoneOrdinal);
      const signer = pickSigner(access, [a.buyer, a.supplier, ...m.approvers], "party or approver");
      const [bundle] = await db()
        .select()
        .from(schema.evidenceBundles)
        .where(and(eq(schema.evidenceBundles.dealId, access.deal.id), eq(schema.evidenceBundles.milestoneOrdinal, m.id)))
        .orderBy(desc(schema.evidenceBundles.createdAt))
        .limit(1);
      if (!bundle || bundle.status === "superseded") throw new ApiError("EVIDENCE_NOT_READY", "Prepare the reviewed evidence bundle for this milestone first.");
      if (bundle.digest === m.evidenceDigest) throw new ApiError("ALREADY_SETTLED", "This evidence bundle is already anchored.");
      return {
        method: "anchor_evidence",
        signer,
        args: [scv.address(signer), scv.u32(m.id), scv.bytes32(bundle.digest)],
        title: `Anchor evidence for milestone ${m.id + 1}`,
        consequences: [
          `Records evidence digest ${bundle.digest} on-chain for "${terms.milestones[m.id]?.name}".`,
          m.approvals.length > 0 ? `Invalidates ${m.approvals.length} existing approval(s) signed against the previous digest.` : "Approvers can then sign this exact digest.",
          "The digest proves which document versions were reviewed; it does not prove the documents are genuine.",
        ],
        amountUnits: null,
        milestoneOrdinal: m.id,
        payload: { bundleId: bundle.id, digest: bundle.digest },
      };
    }
    case "approve_milestone": {
      const m = milestoneOf(snap, input.milestoneOrdinal);
      const signer = pickSigner(access, m.approvers, "appointed approver");
      if (!m.evidenceDigest) throw new ApiError("EVIDENCE_NOT_READY", "No evidence is anchored for this milestone.");
      const [latest] = await db()
        .select()
        .from(schema.evidenceBundles)
        .where(and(eq(schema.evidenceBundles.dealId, access.deal.id), eq(schema.evidenceBundles.milestoneOrdinal, m.id)))
        .orderBy(desc(schema.evidenceBundles.createdAt))
        .limit(1);
      if (latest && latest.digest !== m.evidenceDigest) throw new ApiError("EVIDENCE_DIGEST_MISMATCH", "Reviewed evidence changed after anchoring. Re-anchor the current bundle before approving.");
      const after = new Set([...m.approvals, signer]).size;
      return {
        method: "approve_milestone",
        signer,
        args: [scv.address(signer), scv.u32(m.id), scv.bytes32(m.evidenceDigest)],
        title: `Approve milestone ${m.id + 1}: ${terms.milestones[m.id]?.name}`,
        consequences: [
          `Your approval is bound to evidence digest ${m.evidenceDigest} and becomes void if evidence is re-anchored.`,
          after >= m.quorum ? `Quorum ${after}/${m.quorum} is reached: anyone may then release ${formatAmount(m.amount)} ${asset} to ${names(m.payee)} (${m.payee}).` : `Approvals become ${after}/${m.quorum}; release still needs ${m.quorum - after} more.`,
        ],
        amountUnits: m.amount,
        milestoneOrdinal: m.id,
        payload: { digest: m.evidenceDigest },
      };
    }
    case "revoke_approval": {
      const m = milestoneOf(snap, input.milestoneOrdinal);
      const signer = pickSigner(access, m.approvals, "approver who has approved");
      return { method: "revoke_approval", signer, args: [scv.address(signer), scv.u32(m.id)], title: `Revoke approval on milestone ${m.id + 1}`, consequences: ["Removes your approval; release requires quorum again."], amountUnits: null, milestoneOrdinal: m.id, payload: {} };
    }
    case "open_dispute": {
      const m = milestoneOf(snap, input.milestoneOrdinal);
      const signer = pickSigner(access, [a.buyer, a.supplier], "buyer or supplier");
      const reasonDigest = await disputeReasonDigest({ dealId: access.deal.id, milestoneOrdinal: m.id, reason: input.reason, openedBy: signer });
      return {
        method: "open_dispute",
        signer,
        args: [scv.address(signer), scv.u32(m.id), scv.bytes32(reasonDigest)],
        title: `Open dispute on milestone ${m.id + 1}`,
        consequences: [
          `Freezes ${formatAmount(m.amount)} ${asset} of unreleased funds for this milestone only. Released milestones are final and unaffected.`,
          `Only the named resolver ${names(a.resolver)} (${a.resolver}) can allocate the frozen amount, and must allocate all of it.`,
          "The reason text stays private; only its digest is published on-chain.",
        ],
        amountUnits: m.amount,
        milestoneOrdinal: m.id,
        payload: { reason: input.reason, reasonDigest },
      };
    }
    case "resolve_dispute": {
      const m = milestoneOf(snap, input.milestoneOrdinal);
      const signer = pickSigner(access, [a.resolver], "resolver");
      const toBuyer = parseAmount(input.toBuyer);
      const toPayee = parseAmount(input.toPayee);
      if (toBuyer + toPayee !== m.amount) throw new ApiError("VALIDATION_FAILED", `Allocation must total exactly ${formatAmount(m.amount)}; it totals ${formatAmount(toBuyer + toPayee)}.`);
      return {
        method: "resolve_dispute",
        signer,
        args: [scv.address(signer), scv.u32(m.id), scv.struct({ to_buyer: scv.i128(toBuyer), to_payee: scv.i128(toPayee) })],
        title: `Resolve dispute on milestone ${m.id + 1}`,
        consequences: [`Pays ${formatAmount(toBuyer)} ${asset} to ${names(a.buyer)} and ${formatAmount(toPayee)} ${asset} to ${names(m.payee)} atomically.`, "The milestone becomes permanently settled; this cannot be reversed by Plimsoll."],
        amountUnits: m.amount,
        milestoneOrdinal: m.id,
        payload: { toBuyer: String(toBuyer), toPayee: String(toPayee), rationale: input.rationale },
      };
    }
  }
}

export async function prepareAction(session: SessionContext, dealId: string, input: ActionInput): Promise<PreparedAction> {
  const access = await dealAccess(session, dealId);
  const snap = await freshSnapshot(access);
  const p = await plan(access, snap, input);
  const wallet = session.wallets.find((w) => w.address === p.signer);
  if (!wallet) throw new ApiError("WALLET_REQUIRED", "Your signing wallet is not linked to this account.");

  let tx: Transaction;
  try {
    tx = await gateway().prepareInvocation({ contractId: snap.contractId, method: p.method, args: p.args, source: p.signer });
  } catch (e) {
    if (isChainRejected(e)) {
      await db().insert(schema.chainTransactions).values({ dealId, kind: KIND[p.method], milestoneOrdinal: p.milestoneOrdinal, actorAddress: p.signer, actorUserId: session.user.id, network: network().id, status: "rejected_in_simulation", errorCode: e.contractError, errorDetail: e.message, payload: p.payload });
    }
    throw e;
  }

  const review: ActionReview = {
    title: p.title,
    consequences: p.consequences,
    network: network().label,
    contractId: snap.contractId,
    method: p.method,
    signer: p.signer,
    signerName: participantName(access.participants, p.signer),
    amountUnits: p.amountUnits === null ? null : String(p.amountUnits),
  };
  const [row] = await db()
    .insert(schema.chainTransactions)
    .values({
      dealId,
      kind: KIND[p.method],
      milestoneOrdinal: p.milestoneOrdinal,
      actorAddress: p.signer,
      actorUserId: session.user.id,
      network: network().id,
      status: "prepared",
      amountUnits: p.amountUnits,
      payload: { ...p.payload, method: p.method, xdr: tx.toXDR(), preparedHash: Buffer.from(tx.hash()).toString("hex"), expiresAt: Date.now() + INTENT_TTL_MS, review },
    })
    .returning();

  return {
    intentId: row!.id,
    signing: wallet.accountKind === "demo_custodial" ? "demo_custodial" : "wallet",
    xdr: wallet.accountKind === "demo_custodial" ? null : tx.toXDR(),
    networkPassphrase: network().passphrase,
    review,
  };
}

export async function submitAction(session: SessionContext, dealId: string, intentId: string, signedXdr: string | null): Promise<{ txHash: string; status: "confirmed" | "pending"; ledger: number | null }> {
  const access = await dealAccess(session, dealId);
  const [intent] = await db().select().from(schema.chainTransactions).where(and(eq(schema.chainTransactions.id, intentId), eq(schema.chainTransactions.dealId, dealId)));
  if (!intent || intent.actorUserId !== session.user.id) throw new ApiError("NOT_FOUND", "Signing request not found.");
  if (intent.status !== "prepared") throw new ApiError("ALREADY_SETTLED", "This signing request was already submitted.");
  const payload = intent.payload as { method: SponsoredMethod; xdr: string; preparedHash: string; expiresAt: number; reason?: string; reasonDigest?: string; toBuyer?: string; toPayee?: string; rationale?: string };
  if (Date.now() > payload.expiresAt) {
    await db().update(schema.chainTransactions).set({ status: "expired" }).where(eq(schema.chainTransactions.id, intentId));
    throw new ApiError("SIGNATURE_EXPIRED", "This signing request expired. Prepare it again to re-check current on-chain state.");
  }

  const passphrase = network().passphrase;
  let tx: Transaction;
  if (signedXdr) {
    tx = transactionFromXdr(signedXdr, passphrase);
    if (Buffer.from(tx.hash()).toString("hex") !== payload.preparedHash) throw new ApiError("VALIDATION_FAILED", "The signed transaction differs from the one prepared for review.");
  } else {
    const kp = custodialKeypairFor(intent.actorAddress);
    const wallet = session.wallets.find((w) => w.address === intent.actorAddress);
    if (!kp || wallet?.accountKind !== "demo_custodial") throw new ApiError("WALLET_REQUIRED", "Sign this transaction in your wallet.");
    tx = transactionFromXdr(payload.xdr, passphrase);
    tx.sign(kp);
  }
  assertSponsorable(tx, { contractId: access.deal.escrowContractId!, method: payload.method, signer: intent.actorAddress });
  await assertSponsorQuota(session);

  const txHash = Buffer.from(tx.hash()).toString("hex");
  await db().update(schema.chainTransactions).set({ status: "pending", txHash }).where(eq(schema.chainTransactions.id, intentId));
  if (payload.method === "open_dispute" && intent.milestoneOrdinal !== null) {
    await db().insert(schema.disputes).values({ dealId, milestoneOrdinal: intent.milestoneOrdinal, reason: payload.reason!, reasonDigest: payload.reasonDigest!, openedByAddress: intent.actorAddress, openedByUserId: session.user.id, resolverAddress: access.deal.chainSnapshot!.agreement.resolver, status: "opening", openTxHash: txHash });
  }

  let result;
  try {
    result = await gateway().submitSponsored(tx);
  } catch (e) {
    if (isChainRejected(e)) {
      await db().update(schema.chainTransactions).set({ status: "failed", errorCode: e.contractError, errorDetail: e.message }).where(eq(schema.chainTransactions.id, intentId));
      if (payload.method === "open_dispute") await db().delete(schema.disputes).where(and(eq(schema.disputes.openTxHash, txHash), eq(schema.disputes.status, "opening")));
    }
    throw e;
  }

  const confirmed = result.status === "SUCCESS";
  await db().transaction(async (t) => {
    await t.update(schema.chainTransactions).set({ status: confirmed ? "confirmed" : "pending", ledger: result.ledger, confirmedAt: confirmed ? new Date() : null }).where(eq(schema.chainTransactions.id, intentId));
    if (payload.method === "resolve_dispute" && confirmed) {
      await t
        .update(schema.disputes)
        .set({ resolution: { toBuyer: payload.toBuyer!, toPayee: payload.toPayee!, rationale: payload.rationale! }, resolutionTxHash: txHash })
        .where(and(eq(schema.disputes.dealId, dealId), eq(schema.disputes.milestoneOrdinal, intent.milestoneOrdinal!)));
    }
    if (payload.method === "anchor_evidence" && confirmed) {
      await t.update(schema.evidenceBundles).set({ anchoredTxHash: txHash, anchoredLedger: result.ledger }).where(eq(schema.evidenceBundles.id, String((intent.payload as { bundleId: string }).bundleId)));
    }
    await appendAudit(t, { orgId: session.org?.id, dealId, actorUserId: session.user.id, actorLabel: `${session.user.displayName} (${participantName(access.participants, intent.actorAddress)})`, resourceType: "escrow", resourceId: access.deal.escrowContractId!, action: `escrow.${payload.method}.submitted`, source: "chain", evidence: { txHash, ledger: result.ledger ?? 0, milestone: intent.milestoneOrdinal ?? -1, status: result.status } });
    await enqueue(t, "sync_deal", { dealId }, { dedupeKey: `sync:${dealId}` });
  });
  if (confirmed) await syncDeal(dealId);
  return { txHash, status: confirmed ? "confirmed" : "pending", ledger: result.ledger };
}

/**
 * Release and timed refund are permissionless on-chain, so the relayer executes them. The
 * contract decides eligibility; a rejected simulation is recorded and shown, never faked.
 */
export async function executePermissionless(session: SessionContext, dealId: string, method: "release_milestone" | "refund_expired", milestoneOrdinal: number): Promise<{ txHash: string; ledger: number | null; status: "confirmed" | "pending" }> {
  const access = await dealAccess(session, dealId);
  if (!access.deal.escrowContractId) throw new ApiError("RECONCILIATION_REQUIRED", "No escrow deployed.");
  await assertSponsorQuota(session);
  const kind: ChainTxKind = method === "release_milestone" ? "release" : "refund";
  const args = [scv.u32(milestoneOrdinal)];
  const sim = await gateway().simulate({ contractId: access.deal.escrowContractId, method, args });
  if (!sim.ok) {
    await db().transaction(async (t) => {
      await t.insert(schema.chainTransactions).values({ dealId, kind, milestoneOrdinal, actorAddress: gateway().relayerAddress, actorUserId: session.user.id, network: network().id, status: "rejected_in_simulation", errorCode: sim.error.contractError, errorDetail: sim.error.message });
      await appendAudit(t, { orgId: session.org?.id, dealId, actorUserId: session.user.id, actorLabel: session.user.displayName, resourceType: "escrow", resourceId: access.deal.escrowContractId!, action: `escrow.${method}.rejected`, outcome: "denied", source: "chain", evidence: { milestone: milestoneOrdinal, contractError: sim.error.contractError ?? "unknown" } });
    });
    throw sim.error;
  }
  const res = await gateway().invokeAsRelayer({ contractId: access.deal.escrowContractId, method, args });
  const confirmed = res.status === "SUCCESS";
  const m = access.deal.chainSnapshot?.milestones.find((x) => x.id === milestoneOrdinal);
  await db().transaction(async (t) => {
    await t.insert(schema.chainTransactions).values({ dealId, kind, milestoneOrdinal, actorAddress: gateway().relayerAddress, actorUserId: session.user.id, network: network().id, txHash: res.hash, status: confirmed ? "confirmed" : "pending", ledger: res.ledger, amountUnits: m ? BigInt(m.amount) : null, confirmedAt: confirmed ? new Date() : null, payload: { payee: m?.payee ?? null } });
    await appendAudit(t, { orgId: session.org?.id, dealId, actorUserId: session.user.id, actorLabel: session.user.displayName, resourceType: "escrow", resourceId: access.deal.escrowContractId!, action: `escrow.${method}.executed`, source: "chain", evidence: { txHash: res.hash, ledger: res.ledger ?? 0, milestone: milestoneOrdinal } });
  });
  await syncDeal(dealId);
  return { txHash: res.hash, ledger: res.ledger, status: confirmed ? "confirmed" : "pending" };
}
