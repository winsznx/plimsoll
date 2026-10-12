import { pdfToLines, textToLines } from "@plimsoll/documents";
import { route } from "@/server/http";
import { readVersionBytes, versionAnalysis } from "@/server/services/documents";

export const GET = route<{ id: string; vid: string }>(async ({ params, session }) => {
  const original = await readVersionBytes(session, params.id, params.vid);
  const { fields, lineItems } = await versionAnalysis(params.vid);
  // Every positioned line of the original, so the paper replica shows the whole page, not only matched fields.
  const lines = original.mediaType === "application/pdf" ? (await pdfToLines(original.bytes)).lines : textToLines(new TextDecoder().decode(original.bytes));
  return {
    fields: fields.map((f) => ({ key: f.fieldKey, value: f.value, span: f.span, confidence: f.confidence, method: f.method })),
    lineItems: lineItems.map((l) => ({ sku: l.sku, description: l.description, quantity: l.quantity, uom: l.uom, unitPrice: l.unitPrice, lineTotal: l.lineTotal, grossWeightKg: l.grossWeightKg, span: l.span })),
    lines: lines.map((l) => ({ page: l.page, text: l.text, bbox: l.bbox })),
  };
});
