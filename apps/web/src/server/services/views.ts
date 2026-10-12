import { and, desc, eq, inArray } from "drizzle-orm";
import { conservationHolds, milestoneGate, type ChainSnapshot } from "@plimsoll/domain";
import { explorer, gateway, isChainConfigured, network } from "../chain";
import { db, schema } from "../db/client";
import { chainConfig } from "../env";
import type { SessionContext } from "../auth/session";
import type { DealView, DisputeView, DocumentView, DiscrepancyView, MilestoneView, ShipmentView, TxView } from "@/lib/views";
import { addressNames, dealAccess, participantName, type ParticipantRow } from "./access";
import { dealDocuments } from "./documents";
import { offchainState } from "./evidence";
import { dealDiscrepancies, isBlockingOpen } from "./reconcile";
import { shipmentFor } from "./shipments";
import { loadSnapshot } from "./snapshot";

export function txView(t: typeof schema.chainTransactions.$inferSelect, participants: ParticipantRow[], relayer: string | null): TxView {
  return {
    id: t.id,
    kind: t.kind,
    milestoneOrdinal: t.milestoneOrdinal,
    actorAddress: t.actorAddress,
    actorName: t.actorAddress === relayer ? "Plimsoll relayer" : participantName(participants, t.actorAddress),
    status: t.status,
    txHash: t.txHash,
    ledger: t.ledger,
    amount: t.amountUnits === null ? null : String(t.amountUnits),
    errorCode: t.errorCode,
    errorDetail: t.errorDetail,
    createdAt: t.createdAt.toISOString(),
    explorerUrl: t.txHash && t.status !== "prepared" && t.status !== "rejected_in_simulation" ? explorer("tx", t.txHash) : null,
  };
}

function relayerAddress(): string | null {
  return isChainConfigured() ? gateway().relayerAddress : null;
}

export async function buildDealView(session: SessionContext, dealId: string): Promise<DealView> {
  const access = await dealAccess(session, dealId);
  const { deal, participants } = access;
  const snap: ChainSnapshot | null = deal.chainSnapshot ? loadSnapshot(deal.chainSnapshot) : null;
  const relayer = relayerAddress();
  const [offchain, txs, discrepancies, docs, shipment, disputes] = await Promise.all([
    offchainState(dealId),
    db().select().from(schema.chainTransactions).where(eq(schema.chainTransactions.dealId, dealId)).orderBy(desc(schema.chainTransactions.createdAt)),
    dealDiscrepancies(dealId),
    dealDocuments(dealId),
    shipmentFor(dealId),
    db().select().from(schema.disputes).where(eq(schema.disputes.dealId, dealId)).orderBy(desc(schema.disputes.createdAt)),
  ]);
  const statements = disputes.length ? await db().select({ s: schema.disputeStatements, name: schema.users.displayName }).from(schema.disputeStatements).innerJoin(schema.users, eq(schema.users.id, schema.disputeStatements.authorUserId)).where(inArray(schema.disputeStatements.disputeId, disputes.map((d) => d.id))).orderBy(schema.disputeStatements.createdAt) : [];

  const names = addressNames(participants);
  const actorAddress = access.addresses[0] ?? null;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const myWallet = session.wallets.find((w) => access.addresses.includes(w.address));

  const milestones: MilestoneView[] = deal.terms.milestones.map((m) => {
    const cm = snap?.milestones.find((x) => x.id === m.ordinal) ?? null;
    const off = offchain.find((o) => o.ordinal === m.ordinal);
    const gates = snap && cm ? milestoneGate({ snapshot: snap, offchain, actorAddress, nowSeconds, names }, cm) : null;
    const myGate = snap && cm && access.addresses.length > 1 ? mergeGates(access.addresses.map((addr) => milestoneGate({ snapshot: snap, offchain, actorAddress: addr, nowSeconds, names }, cm))) : gates;
    const settlement = txs.find((t) => t.milestoneOrdinal === m.ordinal && (t.kind === "release" || t.kind === "resolve" || t.kind === "refund") && t.status === "confirmed");
    return {
      ordinal: m.ordinal,
      name: m.name,
      condition: m.condition,
      amount: m.amountUnits,
      payee: m.payee,
      payeeName: participantName(participants, m.payee),
      approvers: m.approvers.map((a) => ({ address: a.address, name: names.get(a.address) ?? a.name, role: a.role, approved: cm?.approvals.includes(a.address) ?? false })),
      quorum: m.quorum,
      refundAfter: m.refundAfter,
      requiredDocuments: m.requiredDocuments,
      chainStatus: cm?.status ?? null,
      evidenceDigest: cm?.evidenceDigest ?? null,
      preparedDigest: off?.preparedBundleDigest ?? null,
      gate: myGate,
      missingDocuments: off?.missingDocuments ?? [],
      openBlockingFindings: off?.openBlockingFindings ?? 0,
      settlementTx: settlement ? txView(settlement, participants, relayer) : null,
    };
  });

  const cfg = chainConfig();
  return {
    id: deal.id,
    reference: deal.reference,
    publicRef: deal.publicRef,
    title: deal.title,
    status: deal.status,
    version: deal.version,
    isSample: deal.isSample,
    network: { id: network().id, label: network().label },
    asset: { code: deal.terms.asset.code, issuer: deal.terms.asset.issuer, contractId: deal.terms.asset.contractId, isDemo: cfg.asset.isDemo },
    terms: deal.terms,
    termsDigest: deal.termsDigest,
    deployTxHash: deal.deployTxHash,
    deployExplorerUrl: deal.deployTxHash ? explorer("tx", deal.deployTxHash) : null,
    chain: snap
      ? {
          contractId: snap.contractId,
          contractExplorerUrl: explorer("contract", snap.contractId),
          status: snap.agreement.status,
          total: String(snap.agreement.total),
          funded: String(snap.agreement.funded),
          released: String(snap.agreement.released),
          refunded: String(snap.agreement.refunded),
          balance: String(snap.balance),
          buyerAccepted: snap.agreement.buyerAccepted,
          supplierAccepted: snap.agreement.supplierAccepted,
          ledger: snap.ledger,
          syncedAt: deal.chainSyncedAt?.toISOString() ?? null,
          syncStatus: deal.chainSyncStatus,
          conservationHolds: conservationHolds(snap),
        }
      : null,
    participants: participants.map((p) => ({ role: p.role, name: p.displayName, address: p.signingAddress, status: p.status, isMe: access.roles.includes(p.role) && (p.userId === session.user.id || (p.orgId !== null && p.orgId === session.org?.id)) })),
    myRoles: access.roles,
    myAddresses: access.addresses,
    mySigning: myWallet ? (myWallet.accountKind === "demo_custodial" ? "demo_custodial" : "wallet") : "none",
    milestones,
    documentsSummary: {
      total: docs.length,
      analyzed: docs.filter((d) => d.versions[0]?.analysisState === "done").length,
      processing: docs.flatMap((d) => d.versions).filter((v) => v.analysisState === "queued" || v.analysisState === "processing").length,
      openBlocking: discrepancies.filter(isBlockingOpen).length,
      openWarnings: discrepancies.filter((d) => d.active && d.severity !== "blocking" && d.state === "open").length,
    },
    transactions: txs.filter((t) => t.status !== "prepared" && t.status !== "expired").map((t) => txView(t, participants, relayer)),
    shipment: shipment ? shipmentView(shipment, names) : null,
    disputes: disputes.map((d): DisputeView => ({
      id: d.id,
      milestoneOrdinal: d.milestoneOrdinal,
      reason: d.reason,
      reasonDigest: d.reasonDigest,
      openedBy: participantName(participants, d.openedByAddress),
      status: d.status,
      resolverAddress: d.resolverAddress,
      resolution: d.resolution,
      openTxHash: d.openTxHash,
      resolutionTxHash: d.resolutionTxHash,
      createdAt: d.createdAt.toISOString(),
      statements: statements.filter((s) => s.s.disputeId === d.id).map((s) => ({ id: s.s.id, author: s.name, role: s.s.authorRole, body: s.s.body, createdAt: s.s.createdAt.toISOString() })),
    })),
  };
}

/** A user holding two roles (e.g. buyer who is also an approver) sees the union of what each allows. */
function mergeGates(gates: ReturnType<typeof milestoneGate>[]): ReturnType<typeof milestoneGate> {
  const [first, ...rest] = gates;
  const allowed = new Set(first!.allowed);
  for (const g of rest) g.allowed.forEach((a) => allowed.add(a));
  const blockedReasons = { ...first!.blockedReasons };
  for (const g of rest) for (const [k, v] of Object.entries(g.blockedReasons)) if (!(k in blockedReasons)) blockedReasons[k as keyof typeof blockedReasons] = v;
  for (const a of allowed) delete blockedReasons[a];
  return { ...first!, allowed: [...allowed], blockedReasons };
}

function shipmentView(s: NonNullable<Awaited<ReturnType<typeof shipmentFor>>>, names: Map<string, string>): ShipmentView {
  return {
    id: s.id,
    stage: s.stage,
    transportMode: s.transportMode,
    incoterm: s.incoterm,
    namedPlace: s.namedPlace,
    originPort: s.originPort,
    destinationPort: s.destinationPort,
    vessel: s.vessel,
    voyage: s.voyage,
    carrierRef: s.carrierRef,
    events: s.events.map((e) => ({ id: e.id, eventCode: e.eventCode, description: e.description, occurredAt: e.occurredAt.toISOString(), recordedAt: e.recordedAt.toISOString(), sourceType: e.sourceType, sourceRef: e.sourceRef, isAttestation: e.isAttestation, signerAddress: e.signerAddress, signerName: e.signerAddress ? (names.get(e.signerAddress) ?? null) : null })),
  };
}

export async function buildDocumentViews(dealId: string): Promise<DocumentView[]> {
  const docs = await dealDocuments(dealId);
  const uploaderIds = [...new Set(docs.flatMap((d) => d.versions.map((v) => v.uploadedBy)))];
  const users = uploaderIds.length ? await db().select().from(schema.users).where(inArray(schema.users.id, uploaderIds)) : [];
  return docs.map((d) => ({
    id: d.id,
    documentType: d.documentType,
    title: d.title,
    versions: d.versions.map((v) => ({ id: v.id, version: v.version, sha256: v.sha256, mediaType: v.mediaType, bytes: v.bytes, fileName: v.fileName, uploadedAt: v.uploadedAt.toISOString(), uploadedBy: users.find((u) => u.id === v.uploadedBy)?.displayName ?? "Unknown", analysisState: v.analysisState, analysisError: v.analysisError, detectedType: v.detectedType, pages: v.pages, modelUsed: v.modelUsed })),
  }));
}

export async function buildDiscrepancyViews(dealId: string): Promise<DiscrepancyView[]> {
  const rows = await dealDiscrepancies(dealId);
  const resolverIds = [...new Set(rows.map((r) => r.resolvedBy).filter((x): x is string => Boolean(x)))];
  const users = resolverIds.length ? await db().select().from(schema.users).where(inArray(schema.users.id, resolverIds)) : [];
  const versionIds = [...new Set(rows.flatMap((r) => [r.actual.versionId, r.expected.versionId]).filter((x): x is string => Boolean(x)))];
  const modelFields = versionIds.length
    ? await db()
        .select({ versionId: schema.extractedFields.documentVersionId, key: schema.extractedFields.fieldKey })
        .from(schema.extractedFields)
        .where(and(inArray(schema.extractedFields.documentVersionId, versionIds), eq(schema.extractedFields.method, "model")))
    : [];
  const modelKeys = new Set(modelFields.map((f) => `${f.versionId}|${f.key}`));
  // Finding fields are "<field key>" or "<field key>:<detail>", e.g. container_numbers:MSKU4826104.
  const modelExtracted = (r: (typeof rows)[number]) => [r.actual.versionId, r.expected.versionId].some((v) => v !== null && modelKeys.has(`${v}|${r.field.split(":")[0]}`));
  return rows.map((r) => ({
    id: r.id,
    ruleId: r.ruleId,
    field: r.field,
    severity: r.severity,
    confidence: r.confidence,
    message: r.message,
    expected: r.expected,
    actual: r.actual,
    state: r.state,
    active: r.active,
    resolutionReason: r.resolutionReason,
    resolvedBy: users.find((u) => u.id === r.resolvedBy)?.displayName ?? null,
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    explanation: r.explanation,
    explanationModel: r.explanationModel,
    modelExtracted: modelExtracted(r),
  }));
}

export async function requireDealAccess(session: SessionContext, dealId: string) {
  return dealAccess(session, dealId);
}
