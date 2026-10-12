import { and, eq, isNull, ne, notInArray } from "drizzle-orm";
import { z } from "zod";
import { reconcile, type DocumentType, type Finding } from "@plimsoll/domain";
import { explainFindings } from "../ai";
import { appendAudit } from "../audit";
import { db, schema } from "../db/client";
import { ApiError } from "../http";
import { enqueue } from "../jobs";
import type { SessionContext } from "../auth/session";
import { dealAccess, requireRole } from "./access";
import { latestExtracted } from "./documents";
import { emitWebhook, notifyParticipants } from "./notify";

/**
 * Re-runs every deterministic rule over the latest version of each document. Findings that no
 * longer reproduce become inactive; reviewer decisions stay attached to their fingerprint.
 */
export async function reconcileDeal(dealId: string): Promise<{ open: number; newlyOpened: number }> {
  const [deal] = await db().select().from(schema.deals).where(eq(schema.deals.id, dealId));
  if (!deal) return { open: 0, newlyOpened: 0 };
  const docs = await latestExtracted(dealId);
  const otherBills = await db()
    .select({ value: schema.extractedFields.value, reference: schema.deals.reference })
    .from(schema.extractedFields)
    .innerJoin(schema.documentVersions, eq(schema.documentVersions.id, schema.extractedFields.documentVersionId))
    .innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId))
    .innerJoin(schema.deals, eq(schema.deals.id, schema.documents.dealId))
    // Only live agreements count: a bill number on an abandoned draft has not been relied on.
    .where(and(eq(schema.extractedFields.fieldKey, "bill_number"), ne(schema.documents.dealId, dealId), notInArray(schema.deals.status, ["draft", "cancelled"])));
  const knownBillNumbers = new Map(otherBills.map((b) => [b.value.toUpperCase(), b.reference]));

  const findings = reconcile({ terms: deal.terms, documents: docs, knownBillNumbers });
  const existing = await db().select().from(schema.discrepancies).where(eq(schema.discrepancies.dealId, dealId));
  const now = new Date();
  const fresh: Finding[] = [];

  await db().transaction(async (tx) => {
    for (const f of findings) {
      const prior = existing.find((e) => e.fingerprint === f.fingerprint);
      if (!prior) {
        fresh.push(f);
        await tx.insert(schema.discrepancies).values({ dealId, fingerprint: f.fingerprint, ruleId: f.ruleId, field: f.field, severity: f.severity, confidence: f.confidence, message: f.message, expected: f.expected, actual: f.actual, active: true, lastSeenAt: now });
        continue;
      }
      const changed = prior.actual.value !== f.actual.value || prior.actual.versionId !== f.actual.versionId;
      await tx
        .update(schema.discrepancies)
        .set({
          message: f.message,
          expected: f.expected,
          actual: f.actual,
          confidence: f.confidence,
          active: true,
          lastSeenAt: now,
          ...(changed || !prior.active ? { state: "open" as const, resolutionReason: null, resolvedBy: null, resolvedAt: null, explanation: null } : {}),
        })
        .where(eq(schema.discrepancies.id, prior.id));
      if (changed || !prior.active) fresh.push(f);
    }
    for (const e of existing) {
      if (findings.some((f) => f.fingerprint === e.fingerprint) || !e.active) continue;
      await tx
        .update(schema.discrepancies)
        .set({ active: false, state: e.state === "open" || e.state === "correction_requested" ? "resolved" : e.state, resolutionReason: e.resolutionReason ?? "No longer reproduced by the current document versions.", resolvedAt: e.resolvedAt ?? now })
        .where(eq(schema.discrepancies.id, e.id));
    }
    await appendAudit(tx, { dealId, actorLabel: "Reconciliation engine", resourceType: "deal", resourceId: dealId, action: "reconciliation.completed", source: "system", evidence: { documents: docs.length, findings: findings.length, newlyOpened: fresh.length } });
    if (fresh.length > 0) await enqueue(tx, "explain_findings", { dealId }, { dedupeKey: `explain:${dealId}` });
  });

  if (fresh.length > 0) {
    const blocking = fresh.filter((f) => f.severity === "blocking").length;
    await notifyParticipants(dealId, { kind: "document.discrepancy", title: `${deal.reference}: ${fresh.length} new document finding${fresh.length === 1 ? "" : "s"}`, body: blocking > 0 ? `${blocking} blocking. Review in the comparison workspace.` : "Review in the comparison workspace.", path: `/deals/${dealId}/documents` });
    for (const f of fresh) await emitWebhook(dealId, "document.discrepancy.opened", { ruleId: f.ruleId, field: f.field, severity: f.severity });
  }
  const open = findings.length;
  return { open, newlyOpened: fresh.length };
}

export async function explainDealFindings(dealId: string): Promise<void> {
  const [deal] = await db().select().from(schema.deals).where(eq(schema.deals.id, dealId));
  if (!deal) return;
  const rows = await db().select().from(schema.discrepancies).where(and(eq(schema.discrepancies.dealId, dealId), eq(schema.discrepancies.active, true), isNull(schema.discrepancies.explanation)));
  if (rows.length === 0) return;
  const explanations = await explainFindings(
    rows.map((r) => ({ ruleId: r.ruleId, fingerprint: r.fingerprint, field: r.field, severity: r.severity, confidence: r.confidence, message: r.message, expected: r.expected, actual: r.actual })),
    { reference: deal.reference, buyer: deal.terms.buyer.legalName, supplier: deal.terms.supplier.legalName },
  );
  for (const e of explanations) {
    await db().update(schema.discrepancies).set({ explanation: e.text, explanationModel: e.model }).where(and(eq(schema.discrepancies.dealId, dealId), eq(schema.discrepancies.fingerprint, e.fingerprint)));
  }
}

export const reviewInput = z.object({
  decision: z.enum(["accepted_as_is", "non_material", "correction_requested"]),
  reason: z.string().min(5).max(2000),
});

/**
 * Human decision on a finding. Blocking findings can be waived only by the buyer, and every
 * decision records who, why and against which document version.
 */
export async function reviewDiscrepancy(session: SessionContext, dealId: string, discrepancyId: string, input: z.infer<typeof reviewInput>): Promise<void> {
  const access = await dealAccess(session, dealId);
  const role = requireRole(access, "buyer", "supplier", "inspector");
  const [d] = await db().select().from(schema.discrepancies).where(and(eq(schema.discrepancies.id, discrepancyId), eq(schema.discrepancies.dealId, dealId)));
  if (!d) throw new ApiError("NOT_FOUND", "Finding not found.");
  if (!d.active) throw new ApiError("ALREADY_SETTLED", "This finding no longer reproduces on the current documents.");
  if (input.decision !== "correction_requested" && d.severity === "blocking" && role !== "buyer") {
    throw new ApiError("ROLE_DENIED", "Only the buyer can waive a blocking finding; others may request a correction.");
  }
  if (input.decision !== "correction_requested" && (d.ruleId === "R-INVOICE-TOTAL" || d.ruleId === "R-CURRENCY")) {
    throw new ApiError("TERMS_VERSION_STALE", "A difference in price or currency changes economic terms and requires a bilateral amendment, not a waiver.");
  }
  await db().transaction(async (tx) => {
    await tx
      .update(schema.discrepancies)
      .set({ state: input.decision, resolutionReason: input.reason, resolvedBy: session.user.id, resolvedAt: new Date() })
      .where(eq(schema.discrepancies.id, discrepancyId));
    await appendAudit(tx, { orgId: session.org?.id, dealId, actorUserId: session.user.id, actorLabel: `${session.user.displayName} (${role})`, resourceType: "discrepancy", resourceId: discrepancyId, action: `discrepancy.${input.decision}`, evidence: { ruleId: d.ruleId, field: d.field, versionId: d.actual.versionId ?? "", reason: input.reason } });
  });
}

export async function dealDiscrepancies(dealId: string) {
  return db().select().from(schema.discrepancies).where(eq(schema.discrepancies.dealId, dealId)).orderBy(schema.discrepancies.firstSeenAt);
}

export function isBlockingOpen(d: { active: boolean; severity: string; state: string }): boolean {
  return d.active && d.severity === "blocking" && (d.state === "open" || d.state === "correction_requested");
}

export function documentTypeOf(value: string): DocumentType {
  return value as DocumentType;
}
