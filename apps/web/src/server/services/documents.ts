import { and, desc, eq, inArray } from "drizzle-orm";
import { DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS, type DocumentType, type ExtractedDocument } from "@plimsoll/domain";
import { analyzeDocument, sniffMediaType, type SupportedMediaType } from "@plimsoll/documents";
import { assistExtraction } from "../ai-extract";
import { appendAudit } from "../audit";
import { db, schema } from "../db/client";
import { ApiError } from "../http";
import { enqueue } from "../jobs";
import { getObject, putObject } from "../objects";
import type { SessionContext } from "../auth/session";
import { dealAccess, requireRole } from "./access";
import { emitWebhook } from "./notify";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const EXTRACTOR_VERSION = "rules-1.0";

export interface UploadInput {
  documentType: DocumentType;
  documentId: string | null;
  fileName: string;
  bytes: Uint8Array;
}

/**
 * Stores an immutable original and queues analysis. Uploading against an existing document
 * creates the next version; earlier versions remain readable forever.
 */
export async function uploadDocument(session: SessionContext, dealId: string, input: UploadInput): Promise<{ documentId: string; versionId: string; version: number; sha256: string }> {
  const access = await dealAccess(session, dealId);
  requireRole(access, "buyer", "supplier", "forwarder", "inspector");
  if (!DOCUMENT_TYPES.includes(input.documentType)) throw new ApiError("VALIDATION_FAILED", "Unsupported document type.");
  if (input.bytes.length === 0 || input.bytes.length > MAX_UPLOAD_BYTES) throw new ApiError("VALIDATION_FAILED", "Documents must be between 1 byte and 20 MB.");
  const mediaType = sniffMediaType(input.bytes);
  if (!mediaType) throw new ApiError("VALIDATION_FAILED", "Only PDF and plain-text documents are accepted. The file content did not match either.");

  const { key, sha256 } = await putObject(input.bytes);
  return db().transaction(async (tx) => {
    let documentId = input.documentId;
    if (documentId) {
      const [doc] = await tx.select().from(schema.documents).where(and(eq(schema.documents.id, documentId), eq(schema.documents.dealId, dealId)));
      if (!doc) throw new ApiError("NOT_FOUND", "Document not found on this deal.");
      if (doc.documentType !== input.documentType) throw new ApiError("VALIDATION_FAILED", "A new version must keep the same document type.");
    } else {
      const [doc] = await tx.insert(schema.documents).values({ dealId, documentType: input.documentType, title: DOCUMENT_TYPE_LABELS[input.documentType], createdBy: session.user.id }).returning();
      documentId = doc!.id;
    }
    const [last] = await tx.select({ version: schema.documentVersions.version }).from(schema.documentVersions).where(eq(schema.documentVersions.documentId, documentId)).orderBy(desc(schema.documentVersions.version)).limit(1);
    const version = (last?.version ?? 0) + 1;
    const [v] = await tx
      .insert(schema.documentVersions)
      .values({ documentId, version, objectKey: key, sha256, mediaType, bytes: input.bytes.length, fileName: input.fileName.slice(0, 200), uploadedBy: session.user.id })
      .returning();
    await appendAudit(tx, { orgId: session.org?.id, dealId, actorUserId: session.user.id, actorLabel: session.user.displayName, resourceType: "document_version", resourceId: v!.id, action: "document.version_uploaded", evidence: { documentType: input.documentType, version, sha256 } });
    await enqueue(tx, "analyze_document", { versionId: v!.id });
    return { documentId, versionId: v!.id, version, sha256 };
  });
}

/**
 * Worker job: deterministic extraction with source spans, an optional model pass that only fills
 * fields the rules missed, then deal-wide reconciliation.
 */
export async function analyzeVersion(versionId: string): Promise<void> {
  const [row] = await db()
    .select({ v: schema.documentVersions, d: schema.documents })
    .from(schema.documentVersions)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId))
    .where(eq(schema.documentVersions.id, versionId));
  if (!row || row.v.analysisState === "done") return;
  await db().update(schema.documentVersions).set({ analysisState: "processing" }).where(eq(schema.documentVersions.id, versionId));
  try {
    const bytes = await getObject(row.v.objectKey);
    const mediaType = row.v.mediaType as SupportedMediaType;
    const analysis = await analyzeDocument(bytes, mediaType);
    const assisted = await assistExtraction({ bytes, mediaType, declaredType: row.d.documentType as DocumentType, analysis });
    const fields = assisted.fields;
    await db().transaction(async (tx) => {
      await tx.delete(schema.extractedFields).where(eq(schema.extractedFields.documentVersionId, versionId));
      await tx.delete(schema.extractedLineItems).where(eq(schema.extractedLineItems.documentVersionId, versionId));
      if (fields.length) await tx.insert(schema.extractedFields).values(fields.map((f) => ({ documentVersionId: versionId, fieldKey: f.key, value: f.value, span: f.span, confidence: f.confidence, method: f.method })));
      if (assisted.lineItems.length)
        await tx.insert(schema.extractedLineItems).values(
          assisted.lineItems.map((l) => ({ documentVersionId: versionId, sku: l.sku, description: l.description, quantity: l.quantity, uom: l.uom, unitPrice: l.unitPrice, lineTotal: l.lineTotal, grossWeightKg: l.grossWeightKg, span: l.span, method: l.method ?? "rule", confidence: l.confidence ?? 1 })),
        );
      await tx
        .update(schema.documentVersions)
        .set({ analysisState: "done", analysisError: assisted.note, detectedType: assisted.detectedType, typeConfidence: assisted.typeConfidence, pages: analysis.pages, extractorVersion: EXTRACTOR_VERSION, modelUsed: assisted.modelUsed })
        .where(eq(schema.documentVersions.id, versionId));
      await appendAudit(tx, {
        dealId: row.d.dealId,
        actorLabel: "Extraction worker",
        resourceType: "document_version",
        resourceId: versionId,
        action: "document.analysis_completed",
        source: "system",
        evidence: {
          fields: fields.length,
          lineItems: assisted.lineItems.length,
          detectedType: assisted.detectedType,
          extractor: EXTRACTOR_VERSION,
          ...(assisted.modelUsed ? { model: assisted.modelUsed, modelFields: assisted.modelFieldCount } : {}),
          ...(assisted.note ? { modelNote: assisted.note } : {}),
        },
      });
      await enqueue(tx, "reconcile_deal", { dealId: row.d.dealId }, { dedupeKey: `reconcile:${row.d.dealId}` });
    });
    await emitWebhook(row.d.dealId, "document.analysis.completed", { documentId: row.d.id, versionId, version: row.v.version });
  } catch (e) {
    await db().update(schema.documentVersions).set({ analysisState: "failed", analysisError: e instanceof Error ? e.message : String(e) }).where(eq(schema.documentVersions.id, versionId));
    throw e;
  }
}

export type DocumentWithVersions = typeof schema.documents.$inferSelect & { versions: (typeof schema.documentVersions.$inferSelect)[] };

export async function dealDocuments(dealId: string): Promise<DocumentWithVersions[]> {
  const docs = await db().select().from(schema.documents).where(eq(schema.documents.dealId, dealId)).orderBy(schema.documents.createdAt);
  if (docs.length === 0) return [];
  const versions = await db().select().from(schema.documentVersions).where(inArray(schema.documentVersions.documentId, docs.map((d) => d.id))).orderBy(desc(schema.documentVersions.version));
  return docs.map((d) => ({ ...d, versions: versions.filter((v) => v.documentId === d.id) }));
}

/** Latest successfully analyzed version of every document on the deal, in reconciler shape. */
export async function latestExtracted(dealId: string): Promise<ExtractedDocument[]> {
  const docs = await dealDocuments(dealId);
  const latest = docs.map((d) => ({ doc: d, v: d.versions[0] })).filter((x): x is { doc: DocumentWithVersions; v: NonNullable<typeof x.v> } => x.v?.analysisState === "done");
  if (latest.length === 0) return [];
  const ids = latest.map((x) => x.v.id);
  const fields = await db().select().from(schema.extractedFields).where(inArray(schema.extractedFields.documentVersionId, ids));
  const lines = await db().select().from(schema.extractedLineItems).where(inArray(schema.extractedLineItems.documentVersionId, ids));
  return latest.map(({ doc, v }) => ({
    documentId: doc.id,
    versionId: v.id,
    version: v.version,
    type: doc.documentType as DocumentType,
    sha256: v.sha256,
    fields: fields.filter((f) => f.documentVersionId === v.id).map((f) => ({ key: f.fieldKey as ExtractedDocument["fields"][number]["key"], value: f.value, span: f.span, confidence: f.confidence, method: f.method })),
    lineItems: lines.filter((l) => l.documentVersionId === v.id).map((l) => ({ sku: l.sku, description: l.description, quantity: l.quantity, uom: l.uom, unitPrice: l.unitPrice, lineTotal: l.lineTotal, grossWeightKg: l.grossWeightKg, span: l.span, method: l.method, confidence: l.confidence })),
  }));
}

export async function versionAnalysis(versionId: string) {
  const fields = await db().select().from(schema.extractedFields).where(eq(schema.extractedFields.documentVersionId, versionId));
  const lineItems = await db().select().from(schema.extractedLineItems).where(eq(schema.extractedLineItems.documentVersionId, versionId));
  return { fields, lineItems };
}

/** Streams an original only to users with access to its deal. */
export async function readVersionBytes(session: SessionContext, dealId: string, versionId: string): Promise<{ bytes: Uint8Array; mediaType: string; fileName: string }> {
  await dealAccess(session, dealId);
  const [row] = await db()
    .select({ v: schema.documentVersions })
    .from(schema.documentVersions)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId))
    .where(and(eq(schema.documentVersions.id, versionId), eq(schema.documents.dealId, dealId)));
  if (!row) throw new ApiError("NOT_FOUND", "Document not found.");
  return { bytes: await getObject(row.v.objectKey), mediaType: row.v.mediaType, fileName: row.v.fileName };
}
