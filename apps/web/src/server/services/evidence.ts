import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { DOCUMENT_TYPE_LABELS, EVIDENCE_SCHEMA, evidenceDigest, type DocumentType, type EvidenceManifest, type OffchainMilestoneState } from "@plimsoll/domain";
import { appendAudit } from "../audit";
import { db, schema } from "../db/client";
import { ApiError } from "../http";
import type { SessionContext } from "../auth/session";
import { dealAccess, requireRole } from "./access";
import { dealDocuments } from "./documents";
import { isBlockingOpen } from "./reconcile";

/** Off-chain readiness per milestone, fed into the shared gate logic. */
export async function offchainState(dealId: string): Promise<OffchainMilestoneState[]> {
  const [deal] = await db().select().from(schema.deals).where(eq(schema.deals.id, dealId));
  if (!deal) return [];
  const docs = await dealDocuments(dealId);
  const presentTypes = new Set(docs.filter((d) => d.versions[0]?.analysisState === "done").map((d) => d.documentType));
  const findings = await db().select().from(schema.discrepancies).where(eq(schema.discrepancies.dealId, dealId));
  const openBlocking = findings.filter(isBlockingOpen).length;
  const bundles = await db().select().from(schema.evidenceBundles).where(eq(schema.evidenceBundles.dealId, dealId)).orderBy(desc(schema.evidenceBundles.createdAt));

  return deal.terms.milestones.map((m) => {
    const latest = bundles.find((b) => b.milestoneOrdinal === m.ordinal && b.status !== "superseded");
    const missing = m.requiredDocuments.filter((t) => !presentTypes.has(t)).map((t) => DOCUMENT_TYPE_LABELS[t]);
    const needsDocs = m.requiredDocuments.length > 0;
    return {
      ordinal: m.ordinal,
      openBlockingFindings: needsDocs ? openBlocking : 0,
      preparedBundleDigest: latest?.digest ?? null,
      missingDocuments: missing,
    };
  });
}

/**
 * Freezes the reviewed evidence for one milestone into a canonical manifest and digest.
 * Refuses while required documents are missing or blocking findings are open.
 */
export async function prepareBundle(session: SessionContext, dealId: string, ordinal: number): Promise<{ digest: string; manifest: EvidenceManifest; reused: boolean }> {
  const access = await dealAccess(session, dealId);
  requireRole(access, "buyer", "supplier", "inspector", "forwarder");
  const deal = access.deal;
  if (!deal.termsDigest) throw new ApiError("EVIDENCE_NOT_READY", "Terms must be submitted before evidence can be bound to them.");
  const milestone = deal.terms.milestones.find((m) => m.ordinal === ordinal);
  if (!milestone) throw new ApiError("NOT_FOUND", "Milestone not found.");

  const state = (await offchainState(dealId)).find((s) => s.ordinal === ordinal)!;
  if (state.missingDocuments.length > 0) throw new ApiError("EVIDENCE_NOT_READY", `Missing required documents: ${state.missingDocuments.join(", ")}.`);
  if (state.openBlockingFindings > 0) throw new ApiError("EVIDENCE_NOT_READY", `${state.openBlockingFindings} blocking finding(s) must be corrected or waived by the buyer first.`);

  const docs = await dealDocuments(dealId);
  const included = docs
    .filter((d) => milestone.requiredDocuments.length === 0 || milestone.requiredDocuments.includes(d.documentType as DocumentType) || d.documentType === "purchase_order")
    .map((d) => ({ doc: d, v: d.versions[0]! }))
    .filter((x) => x.v?.analysisState === "done");
  const findings = await db().select().from(schema.discrepancies).where(eq(schema.discrepancies.dealId, dealId));
  const reviewed = findings.filter((f) => f.state !== "open" && f.state !== "correction_requested");

  const shipment = await db().select().from(schema.shipments).where(eq(schema.shipments.dealId, dealId));
  const attestations = shipment[0] ? await db().select().from(schema.shipmentEvents).where(and(eq(schema.shipmentEvents.shipmentId, shipment[0].id), eq(schema.shipmentEvents.isAttestation, true))) : [];

  const manifest: EvidenceManifest = {
    schema: EVIDENCE_SCHEMA,
    dealId,
    milestoneOrdinal: ordinal,
    agreementDigest: deal.termsDigest,
    documents: included.map(({ doc, v }) => ({ documentId: doc.id, versionId: v.id, version: v.version, documentType: doc.documentType, sha256: v.sha256 })),
    findings: reviewed.map((f) => ({ ruleId: f.ruleId, fingerprint: f.fingerprint, state: f.state as "resolved" | "accepted_as_is" | "non_material", reason: f.resolutionReason ?? "" })),
    attestations: attestations.map((a) => ({
      signer: a.signerAddress ?? "",
      statement: `${a.eventCode}: ${a.description}`,
      digest: createHash("sha256").update(`${a.id}|${a.eventCode}|${a.occurredAt.toISOString()}|${a.signerAddress ?? ""}`).digest("hex"),
    })),
  };
  const digest = await evidenceDigest(manifest);

  const [latest] = await db().select().from(schema.evidenceBundles).where(and(eq(schema.evidenceBundles.dealId, dealId), eq(schema.evidenceBundles.milestoneOrdinal, ordinal))).orderBy(desc(schema.evidenceBundles.createdAt)).limit(1);
  if (latest && latest.digest === digest && latest.status !== "superseded") return { digest, manifest: latest.manifest, reused: true };

  await db().transaction(async (tx) => {
    await tx.update(schema.evidenceBundles).set({ status: "superseded" }).where(and(eq(schema.evidenceBundles.dealId, dealId), eq(schema.evidenceBundles.milestoneOrdinal, ordinal), eq(schema.evidenceBundles.status, "prepared")));
    await tx.insert(schema.evidenceBundles).values({ dealId, milestoneOrdinal: ordinal, manifest, digest, createdBy: session.user.id });
    await appendAudit(tx, { orgId: session.org?.id, dealId, actorUserId: session.user.id, actorLabel: session.user.displayName, resourceType: "evidence_bundle", resourceId: digest, action: "evidence.bundle_prepared", evidence: { milestone: ordinal, digest, documents: manifest.documents.length } });
  });
  return { digest, manifest, reused: false };
}

export async function bundlesFor(dealId: string) {
  return db().select().from(schema.evidenceBundles).where(eq(schema.evidenceBundles.dealId, dealId)).orderBy(desc(schema.evidenceBundles.createdAt));
}
