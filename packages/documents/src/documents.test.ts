import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAmount, reconcile, type DealTerms, type ExtractedDocument } from "@plimsoll/domain";
import { CANONICAL, analyzeDocument, billOfLadingSpec, commercialInvoiceSpec, packingListSpec, renderTradeDocument, sniffMediaType } from "./index";

async function extracted(spec: Parameters<typeof renderTradeDocument>[0], id: string): Promise<ExtractedDocument> {
  const bytes = await renderTradeDocument(spec);
  const a = await analyzeDocument(bytes, "application/pdf");
  return { documentId: id, versionId: `${id}-v`, version: 1, type: a.detectedType, sha256: id, fields: a.fields, lineItems: a.lineItems };
}

function canonicalTerms(): DealTerms {
  const lines = CANONICAL.lines.map((l) => ({ sku: l.sku, description: l.description, quantity: l.quantity, uom: l.uom, unitPriceUnits: String(parseAmount(l.unitPrice)), totalUnits: String(parseAmount(l.total)) }));
  return {
    schema: "plimsoll.terms.v1",
    dealId: "d",
    reference: CANONICAL.reference,
    poNumber: CANONICAL.poNumber,
    network: "testnet",
    asset: { code: "DEMOUSD", issuer: "G", contractId: "C", currency: "USD" },
    buyer: { orgId: "b", legalName: CANONICAL.buyer, address: "GB" },
    supplier: { orgId: "s", legalName: CANONICAL.supplier, address: "GS" },
    resolver: { name: CANONICAL.resolver, address: "GR" },
    goods: { lineItems: lines, incoterm: { rule: "FOB", namedPlace: "Ningbo", edition: "Incoterms® 2020" }, transportMode: "sea", originPort: "Ningbo", destinationPort: "Felixstowe" },
    governingLaw: "England and Wales",
    disputeForum: "Named resolver",
    totalUnits: String(parseAmount(CANONICAL.total)),
    fundingDeadline: 0,
    tolerances: { quantityBps: 0, weightBps: 200 },
    milestones: [],
  };
}

describe("document analysis", () => {
  it("classifies and extracts the commercial invoice with source spans", async () => {
    // #given
    const doc = await extracted(commercialInvoiceSpec(), "inv");
    // #then
    expect(doc.type).toBe("commercial_invoice");
    expect(doc.fields.find((f) => f.key === "po_number")?.value).toBe("PO-88231");
    expect(doc.fields.find((f) => f.key === "total_amount")?.value).toBe("148600.00");
    expect(doc.lineItems.map((l) => [l.sku, l.quantity, l.unitPrice, l.lineTotal])).toEqual([
      ["KC-TILE-60", 320, "285.00", "91200.00"],
      ["KC-TILE-30", 160, "358.75", "57400.00"],
    ]);
    expect(doc.fields[0]!.span.bbox).not.toBeNull();
  });

  it("flags the short-shipped packing list as one blocking quantity finding", async () => {
    // #given
    const docs = [await extracted(commercialInvoiceSpec(), "inv"), await extracted(packingListSpec(false), "pl"), await extracted(billOfLadingSpec(), "bl")];
    // #when
    const findings = reconcile({ terms: canonicalTerms(), documents: docs });
    // #then
    expect(findings.map((f) => `${f.ruleId}:${f.field}:${f.actual.value}`)).toEqual(["R-QTY:qty:KC-TILE-30:148"]);
  });

  it("produces no findings once the corrected packing list replaces v1", async () => {
    // #given
    const docs = [await extracted(commercialInvoiceSpec(), "inv"), await extracted(packingListSpec(true), "pl"), await extracted(billOfLadingSpec(), "bl")];
    // #when
    const findings = reconcile({ terms: canonicalTerms(), documents: docs });
    // #then
    expect(findings).toEqual([]);
  });

  it("sniffs media type from bytes rather than headers", () => {
    expect(sniffMediaType(new TextEncoder().encode("%PDF-1.7"))).toBe("application/pdf");
    expect(sniffMediaType(new TextEncoder().encode("Invoice No: 1\n"))).toBe("text/plain");
    expect(sniffMediaType(new Uint8Array([0x4d, 0x5a, 0x90, 0x00]))).toBeNull();
  });

  it("reads no text from the scanned packing list, so only the model path can extract it", async () => {
    // #given
    const bytes = new Uint8Array(readFileSync(resolve(import.meta.dirname, "../../../tests/fixtures/packing-list-v1-scanned.pdf")));
    // #when
    const a = await analyzeDocument(bytes, "application/pdf");
    // #then
    expect(sniffMediaType(bytes)).toBe("application/pdf");
    expect(a.pages).toBe(1);
    expect(a.lines).toEqual([]);
    expect(a.fields).toEqual([]);
    expect(a.lineItems).toEqual([]);
    expect(a.detectedType).toBe("other");
  });
});
