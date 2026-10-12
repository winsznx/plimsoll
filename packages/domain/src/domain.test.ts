import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  evidenceDigest,
  formatAmount,
  isValidContainerNumber,
  normalizePartyName,
  parseAmount,
  reconcile,
  splitByBasisPoints,
  termsDigest,
  validateTerms,
  type DealTerms,
  type ExtractedDocument,
  type EvidenceManifest,
} from "./index";

const span = { page: 1, bbox: null, text: "" };

function terms(): DealTerms {
  return {
    schema: "plimsoll.terms.v1",
    dealId: "6f2b1c1e-0000-4000-8000-000000000001",
    reference: "PL-2048",
    poNumber: "PO-88231",
    network: "testnet",
    asset: { code: "DEMOUSD", issuer: "GISSUER", contractId: "CTOKEN", currency: "USD" },
    buyer: { orgId: "b", legalName: "Northbank Home Supply Ltd", address: "GBUYER" },
    supplier: { orgId: "s", legalName: "Kestrel Ceramics Co., Ltd.", address: "GSUPPLIER" },
    resolver: { name: "Harbour Arbitration Desk", address: "GRESOLVER" },
    goods: {
      lineItems: [{ sku: "KC-TILE-60", description: "Porcelain floor tile", quantity: 480, uom: "cartons", unitPriceUnits: String(parseAmount("309.5833333")), totalUnits: String(parseAmount("309.5833333") * 480n) }],
      incoterm: { rule: "FOB", namedPlace: "Ningbo", edition: "Incoterms® 2020" },
      transportMode: "sea",
      originPort: "Ningbo",
      destinationPort: "Felixstowe",
    },
    governingLaw: "England and Wales",
    disputeForum: "Named resolver",
    totalUnits: String(parseAmount("309.5833333") * 480n),
    fundingDeadline: 0,
    tolerances: { quantityBps: 0, weightBps: 200 },
    milestones: [
      { ordinal: 0, name: "Purchase confirmed", condition: "", amountUnits: String(parseAmount("309.5833333") * 480n), payee: "GSUPPLIER", approvers: [{ address: "GBUYER", role: "buyer", name: "Buyer" }], quorum: 1, refundAfter: 0, requiredDocuments: [] },
    ],
  };
}

function doc(type: ExtractedDocument["type"], qty: number, extra: Partial<ExtractedDocument> = {}): ExtractedDocument {
  return {
    documentId: `${type}-id`,
    versionId: `${type}-v1`,
    version: 1,
    type,
    sha256: `${type}-sha`,
    fields: [
      { key: "po_number", value: "PO-88231", span, confidence: 0.99, method: "rule" },
      { key: "seller_name", value: "KESTREL CERAMICS CO LTD", span, confidence: 0.99, method: "rule" },
    ],
    lineItems: [{ sku: "KC-TILE-60", description: "tile", quantity: qty, uom: "cartons", unitPrice: null, lineTotal: null, grossWeightKg: null, span }],
    ...extra,
  };
}

describe("money", () => {
  it("round-trips decimal strings without floating point", () => {
    expect(parseAmount("148,600.00")).toBe(1_486_000_000_000n);
    expect(formatAmount(1_486_000_000_000n)).toBe("148,600.00");
    expect(formatAmount(1n, { minFraction: 0 })).toBe("0.0000001");
    expect(() => parseAmount("1.00000001")).toThrow();
    expect(() => parseAmount("-1")).toThrow();
  });

  it("splits by basis points and keeps every unit", () => {
    const parts = splitByBasisPoints(1_000_000_001n, [2000, 6000, 2000]);
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(1_000_000_001n);
  });
});

describe("digests", () => {
  it("canonicalizes key order", () => {
    expect(canonicalJson({ b: 1, a: [true, null, "x"] })).toBe('{"a":[true,null,"x"],"b":1}');
  });

  it("evidence digest ignores collection order but not content", async () => {
    const base: EvidenceManifest = {
      schema: "plimsoll.evidence.v1",
      dealId: "d",
      milestoneOrdinal: 1,
      agreementDigest: "a".repeat(64),
      documents: [
        { documentId: "1", versionId: "1a", version: 1, documentType: "commercial_invoice", sha256: "aa" },
        { documentId: "2", versionId: "2a", version: 2, documentType: "packing_list", sha256: "bb" },
      ],
      findings: [],
      attestations: [],
    };
    const reordered = { ...base, documents: [...base.documents].reverse() };
    expect(await evidenceDigest(base)).toBe(await evidenceDigest(reordered));
    const changed = { ...base, documents: [{ ...base.documents[0]!, sha256: "ab" }, base.documents[1]!] };
    expect(await evidenceDigest(base)).not.toBe(await evidenceDigest(changed));
  });

  it("terms digest is stable and sensitive to amounts", async () => {
    const t = terms();
    expect(await termsDigest(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(await termsDigest(t)).toBe(await termsDigest(structuredClone(t)));
    const changed = { ...t, totalUnits: "1" };
    expect(await termsDigest(t)).not.toBe(await termsDigest(changed));
  });
});

describe("terms validation", () => {
  it("accepts consistent terms and rejects broken sums", () => {
    expect(validateTerms(terms())).toEqual([]);
    const broken = terms();
    broken.milestones[0]!.amountUnits = "1";
    expect(validateTerms(broken).map((i) => i.path)).toContain("milestones");
  });
});

describe("reconciliation", () => {
  it("flags the packing list quantity mismatch as blocking", () => {
    const findings = reconcile({ terms: terms(), documents: [doc("commercial_invoice", 480), doc("packing_list", 468)] });
    const qty = findings.filter((f) => f.ruleId === "R-QTY");
    expect(qty).toHaveLength(1);
    expect(qty[0]!.severity).toBe("blocking");
    expect(qty[0]!.actual.value).toBe("468");
  });

  it("clears the quantity finding once the corrected version matches", () => {
    const findings = reconcile({ terms: terms(), documents: [doc("commercial_invoice", 480), doc("packing_list", 480)] });
    expect(findings.filter((f) => f.ruleId === "R-QTY")).toHaveLength(0);
  });

  it("normalizes legal suffixes when comparing party names", () => {
    expect(normalizePartyName("Kestrel Ceramics Co., Ltd.")).toBe(normalizePartyName("KESTREL CERAMICS CO LTD"));
  });

  it("validates ISO 6346 container check digits", () => {
    expect(isValidContainerNumber("CSQU3054383")).toBe(true);
    expect(isValidContainerNumber("CSQU3054384")).toBe(false);
  });

  it("requires human confirmation for a model-read quantity even when it matches", () => {
    // #given
    const scanned = doc("packing_list", 480);
    scanned.lineItems[0] = { ...scanned.lineItems[0]!, method: "model", confidence: 0.8 };
    // #when
    const findings = reconcile({ terms: terms(), documents: [doc("commercial_invoice", 480), scanned] });
    // #then
    const quantityFindings = findings.filter((f) => f.ruleId === "R-MODEL-QTY" || f.ruleId === "R-QTY");
    expect(quantityFindings.map((f) => [f.ruleId, f.severity, f.confidence])).toEqual([["R-MODEL-QTY", "blocking", 0.8]]);
  });

  it("detects a wrong PO number", () => {
    const d = doc("commercial_invoice", 480);
    d.fields[0] = { ...d.fields[0]!, value: "PO-99999" };
    expect(reconcile({ terms: terms(), documents: [d] }).some((f) => f.ruleId === "R-PO")).toBe(true);
  });
});
