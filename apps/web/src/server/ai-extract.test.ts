import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractedField } from "@plimsoll/domain";
import { analyzeDocument, type DocumentAnalysis } from "@plimsoll/documents";
import type { ModelExtraction } from "./ai-extract";

const { create, envState } = vi.hoisted(() => ({
  create: vi.fn(),
  envState: { ANTHROPIC_API_KEY: undefined as string | undefined, PLIMSOLL_MODEL: "claude-opus-5-5" },
}));

vi.mock("./env", () => ({ env: () => envState }));
vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  class MockAnthropic {
    static APIError = actual.default.APIError;
    beta = { messages: { create } };
  }
  return { default: MockAnthropic };
});

const { MODEL_CONFIDENCE_CAP, assistExtraction, modelFieldsToAdd, modelLineItemsToAdd, needsModelAssist } = await import("./ai-extract");

const PDF = new TextEncoder().encode("%PDF-1.7 scanned");

function ruleField(key: ExtractedField["key"], value: string): ExtractedField {
  return { key, value, span: { page: 1, bbox: [48, 700, 200, 10], text: `${key}: ${value}` }, confidence: 0.98, method: "rule" };
}

function analysisOf(fields: ExtractedField[], lineCount: number): DocumentAnalysis {
  const lines = Array.from({ length: lineCount }, (_, i) => ({ page: 1, text: `line ${i}`, cells: [{ text: `line ${i}`, x: 48 }], bbox: [48, 700 - i * 15, 100, 10] as [number, number, number, number] }));
  return { detectedType: lineCount === 0 ? "other" : "packing_list", typeConfidence: lineCount === 0 ? 0.2 : 0.95, pages: 1, lines, fields, lineItems: [] };
}

function modelReply(payload: unknown, overrides: Record<string, unknown> = {}) {
  return { model: "claude-opus-5-5", stop_reason: "end_turn", stop_details: null, content: [{ type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload) }], ...overrides };
}

const SCANNED_READING: Omit<ModelExtraction, "model"> = {
  suggestedType: "packing_list",
  typeConfidence: 0.97,
  fields: [
    { key: "po_number", value: "PO-88231", sourceText: "PO Number: PO-88231", page: 1, confidence: 0.99 },
    { key: "gross_weight_kg", value: "15,840", sourceText: "Gross Weight (kg): 15840", page: 1, confidence: 0.9 },
    { key: "consignee_name", value: "Northbank Home Supply Ltd", sourceText: "Consignee: Northbank Home Supply Ltd", page: 1, confidence: 0.6 },
  ],
  lineItems: [
    { sku: "KC-TILE-60", description: "Porcelain floor tile", quantity: 320, uom: "cartons", sourceText: "KC-TILE-60 Porcelain floor tile 320 cartons", page: 1, confidence: 0.95 },
    { sku: "KC-TILE-30", description: "Porcelain wall tile", quantity: 148, uom: "cartons", sourceText: "KC-TILE-30 Porcelain wall tile 148 cartons", page: 1, confidence: 0.9 },
    { sku: "??", description: "smudged", quantity: 3, uom: "cartons", sourceText: "?? smudged", page: 1, confidence: 0.4 },
  ],
};

beforeEach(() => {
  create.mockReset();
  envState.ANTHROPIC_API_KEY = "test-key";
});

describe("modelLineItemsToAdd", () => {
  it("fills line items only for a scan, marks them model-read and caps confidence", () => {
    // #when
    const items = modelLineItemsToAdd([], SCANNED_READING, 1);
    // #then
    expect(items.map((i) => [i.sku, i.quantity, i.method, i.confidence])).toEqual([
      ["KC-TILE-60", 320, "model", 0.85],
      ["KC-TILE-30", 148, "model", 0.85],
    ]);
  });

  it("never replaces line items the rules parsed", () => {
    // #given
    const ruleItem = { sku: "KC-TILE-30", description: "x", quantity: 160, uom: "cartons", unitPrice: null, lineTotal: null, grossWeightKg: null, span: { page: 1, bbox: null, text: "" } };
    // #then
    expect(modelLineItemsToAdd([ruleItem], SCANNED_READING, 1)).toEqual([]);
  });
});

describe("needsModelAssist", () => {
  it("triggers when the PDF has no text layer", () => {
    expect(needsModelAssist(analysisOf([], 0), "packing_list")).toBe(true);
    expect(needsModelAssist(analysisOf([], 0), "other")).toBe(true);
  });

  it("triggers when fewer than half of the declared type's required fields were found", () => {
    // #given packing lists require five fields
    const two = [ruleField("po_number", "PO-1"), ruleField("seller_name", "S")];
    const three = [...two, ruleField("consignee_name", "C")];
    // #then
    expect(needsModelAssist(analysisOf(two, 12), "packing_list")).toBe(true);
    expect(needsModelAssist(analysisOf(three, 12), "packing_list")).toBe(false);
  });

  it("does not trigger for a readable document type that has no required fields", () => {
    expect(needsModelAssist(analysisOf([], 12), "certificate_of_origin")).toBe(false);
  });
});

describe("modelFieldsToAdd", () => {
  it("never replaces a rule-found field and only fills gaps", () => {
    // #given the rules found the PO number
    const rules = [ruleField("po_number", "PO-RULE")];
    // #when
    const added = modelFieldsToAdd(rules, SCANNED_READING, 1);
    // #then
    expect(added.map((f) => f.key)).toEqual(["gross_weight_kg", "consignee_name"]);
    expect(added.every((f) => f.method === "model")).toBe(true);
  });

  it("caps confidence, cites the quoted source and page, and has no box", () => {
    // #when
    const added = modelFieldsToAdd([], SCANNED_READING, 1);
    // #then
    const po = added.find((f) => f.key === "po_number")!;
    expect(po.confidence).toBe(MODEL_CONFIDENCE_CAP);
    expect(po.span).toEqual({ page: 1, bbox: null, text: "PO Number: PO-88231" });
    expect(added.find((f) => f.key === "consignee_name")!.confidence).toBe(0.6);
    expect(added.find((f) => f.key === "gross_weight_kg")!.value).toBe("15840");
  });

  it("drops uncited values, pages that do not exist, unparseable numbers and repeated keys", () => {
    // #given
    const reading = {
      fields: [
        { key: "vessel" as const, value: "MSC ALINA", sourceText: "  ", page: 1, confidence: 0.9 },
        { key: "voyage" as const, value: "FE612W", sourceText: "Voyage: FE612W", page: 3, confidence: 0.9 },
        { key: "total_amount" as const, value: "about 148k", sourceText: "Total: about 148k", page: 1, confidence: 0.9 },
        { key: "currency" as const, value: "usd", sourceText: "Currency: USD", page: 1, confidence: 0.9 },
        { key: "currency" as const, value: "EUR", sourceText: "EUR", page: 1, confidence: 0.9 },
      ],
    };
    // #when
    const added = modelFieldsToAdd([], reading, 1);
    // #then
    expect(added.map((f) => [f.key, f.value])).toEqual([["currency", "USD"]]);
  });
});

describe("assistExtraction", () => {
  it("leaves the rule result untouched and never calls the model without an API key", async () => {
    // #given
    envState.ANTHROPIC_API_KEY = undefined;
    const analysis = analysisOf([], 0);
    // #when
    const out = await assistExtraction({ bytes: PDF, mediaType: "application/pdf", declaredType: "packing_list", analysis });
    // #then
    expect(create).not.toHaveBeenCalled();
    expect(out).toEqual({ lineItems: [], fields: [], detectedType: "other", typeConfidence: 0.2, modelUsed: null, modelFieldCount: 0, note: null });
  });

  it("does not call the model when the rules read enough of the document", async () => {
    // #given
    const fields = [ruleField("po_number", "PO-1"), ruleField("seller_name", "S"), ruleField("consignee_name", "C")];
    // #when
    const out = await assistExtraction({ bytes: PDF, mediaType: "application/pdf", declaredType: "packing_list", analysis: analysisOf(fields, 12) });
    // #then
    expect(create).not.toHaveBeenCalled();
    expect(out.fields).toBe(fields);
    expect(out.modelUsed).toBeNull();
  });

  it("sends a scanned PDF as a document block and adds capped model fields", async () => {
    // #given
    create.mockResolvedValue(modelReply(SCANNED_READING));
    // #when
    const out = await assistExtraction({ bytes: PDF, mediaType: "application/pdf", declaredType: "packing_list", analysis: analysisOf([], 0) });
    // #then
    const request = create.mock.calls[0]![0];
    expect(request.model).toBe("claude-opus-5-5");
    expect(request.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(request.fallbacks).toBe("default");
    expect(request.output_config.format.type).toBe("json_schema");
    expect(request.system).toMatch(/untrusted/);
    expect(request.messages[0].content[0]).toEqual({ type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(PDF).toString("base64") } });
    expect(out.modelUsed).toBe("claude-opus-5-5");
    expect(out.modelFieldCount).toBe(5);
    expect(out.lineItems.map((l) => [l.sku, l.quantity, l.method])).toEqual([["KC-TILE-60", 320, "model"], ["KC-TILE-30", 148, "model"]]);
    expect(out.fields.every((f) => f.method === "model" && f.span.bbox === null && f.confidence <= MODEL_CONFIDENCE_CAP)).toBe(true);
    expect(out.note).toBeNull();
  });

  it("routes the scanned packing-list fixture through the model", async () => {
    // #given
    const bytes = new Uint8Array(readFileSync(resolve(import.meta.dirname, "../../../../tests/fixtures/packing-list-v1-scanned.pdf")));
    const analysis = await analyzeDocument(bytes, "application/pdf");
    create.mockResolvedValue(modelReply(SCANNED_READING));
    // #when
    const out = await assistExtraction({ bytes, mediaType: "application/pdf", declaredType: "packing_list", analysis });
    // #then
    expect(create).toHaveBeenCalledOnce();
    expect(out.fields.map((f) => [f.key, f.value, f.method])).toEqual([
      ["po_number", "PO-88231", "model"],
      ["gross_weight_kg", "15840", "model"],
      ["consignee_name", "Northbank Home Supply Ltd", "model"],
    ]);
  });

  it("records the model's type suggestion only when the rules could not classify", async () => {
    // #given
    create.mockResolvedValue(modelReply(SCANNED_READING));
    // #when
    const unreadable = await assistExtraction({ bytes: PDF, mediaType: "application/pdf", declaredType: "packing_list", analysis: analysisOf([], 0) });
    const classified = await assistExtraction({ bytes: PDF, mediaType: "application/pdf", declaredType: "packing_list", analysis: { ...analysisOf([], 12), detectedType: "commercial_invoice" } });
    // #then
    expect([unreadable.detectedType, unreadable.typeConfidence]).toEqual(["packing_list", MODEL_CONFIDENCE_CAP]);
    expect([classified.detectedType, classified.typeConfidence]).toEqual(["commercial_invoice", 0.95]);
  });

  it.each([
    ["a refusal", modelReply("", { stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber", explanation: null } }), /declined/],
    ["a truncated answer", modelReply("{", { stop_reason: "max_tokens" }), /cut off/],
    ["malformed JSON", modelReply("not json"), /malformed/],
    ["an off-schema answer", modelReply({ suggestedType: "packing_list", typeConfidence: 1, fields: [{ key: "price", value: "1" }] }), /schema/],
  ])("keeps rule results and notes the failure on %s", async (_label, reply, reason) => {
    // #given
    create.mockResolvedValue(reply);
    const rules = [ruleField("po_number", "PO-1")];
    // #when
    const out = await assistExtraction({ bytes: PDF, mediaType: "application/pdf", declaredType: "packing_list", analysis: analysisOf(rules, 3) });
    // #then
    expect(out.fields).toBe(rules);
    expect(out.modelUsed).toBeNull();
    expect(out.note).toMatch(reason);
    expect(out.note).toMatch(/rule results only/);
  });

  it("keeps rule results when the API call itself fails", async () => {
    // #given
    create.mockRejectedValue(new Error("socket hang up"));
    // #when
    const out = await assistExtraction({ bytes: PDF, mediaType: "application/pdf", declaredType: "packing_list", analysis: analysisOf([], 0) });
    // #then
    expect(out.fields).toEqual([]);
    expect(out.note).toBe("Model-assisted extraction failed: socket hang up. Showing rule results only.");
  });
});
