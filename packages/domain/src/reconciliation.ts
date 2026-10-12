import { parseAmount, formatAmount } from "./money";
import type { DealTerms, DocumentType } from "./terms";

export const FIELD_KEYS = [
  "po_number",
  "document_number",
  "document_date",
  "currency",
  "seller_name",
  "buyer_name",
  "consignee_name",
  "total_amount",
  "incoterm",
  "incoterm_place",
  "port_of_loading",
  "port_of_discharge",
  "vessel",
  "voyage",
  "container_numbers",
  "bill_number",
  "gross_weight_kg",
  "total_packages",
  "shipment_date",
] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

export interface SourceSpan {
  page: number;
  /** PDF user-space box [x, y, width, height] of the source line, when known. */
  bbox: [number, number, number, number] | null;
  text: string;
}

export interface ExtractedField {
  key: FieldKey;
  value: string;
  span: SourceSpan;
  confidence: number;
  method: "rule" | "model";
}

export interface ExtractedLineItem {
  sku: string;
  description: string;
  quantity: number;
  uom: string;
  unitPrice: string | null;
  lineTotal: string | null;
  grossWeightKg: string | null;
  span: SourceSpan;
  /** "model" when read by a model from a scan rather than parsed from a text layer. */
  method?: "rule" | "model";
  confidence?: number;
}

export interface ExtractedDocument {
  documentId: string;
  versionId: string;
  version: number;
  type: DocumentType;
  sha256: string;
  fields: ExtractedField[];
  lineItems: ExtractedLineItem[];
}

export type Severity = "blocking" | "warning" | "info";

export interface FindingSide {
  documentId: string | null;
  versionId: string | null;
  documentType: DocumentType | "agreement";
  value: string | null;
  span: SourceSpan | null;
}

export interface Finding {
  ruleId: string;
  /** Stable across re-runs for the same issue so reviewer decisions can carry over. */
  fingerprint: string;
  field: string;
  severity: Severity;
  confidence: number;
  message: string;
  expected: FindingSide;
  actual: FindingSide;
}

export const RULES = {
  requiredField: { id: "R-REQUIRED", title: "Required field missing" },
  poNumber: { id: "R-PO", title: "Purchase order number mismatch" },
  currency: { id: "R-CURRENCY", title: "Currency mismatch" },
  party: { id: "R-PARTY", title: "Party name discrepancy" },
  consignee: { id: "R-CONSIGNEE", title: "Consignee missing" },
  quantity: { id: "R-QTY", title: "Quantity outside agreed tolerance" },
  lineArithmetic: { id: "R-LINE-TOTAL", title: "Line arithmetic inconsistent" },
  invoiceTotal: { id: "R-INVOICE-TOTAL", title: "Invoice total differs from agreement" },
  weight: { id: "R-WEIGHT", title: "Gross weight outside tolerance" },
  container: { id: "R-CONTAINER", title: "Container numbers inconsistent" },
  containerCheckDigit: { id: "R-CONTAINER-CHECK", title: "Container number fails ISO 6346 check digit" },
  incoterm: { id: "R-INCOTERM", title: "Incoterms® rule or place mismatch" },
  port: { id: "R-PORT", title: "Port mismatch" },
  dates: { id: "R-DATES", title: "Invalid date sequence" },
  duplicate: { id: "R-DUPLICATE", title: "Duplicate document or reused bill number" },
  modelQuantity: { id: "R-MODEL-QTY", title: "Quantity read by model; needs human confirmation" },
} as const;

export const REQUIRED_FIELDS: Partial<Record<DocumentType, FieldKey[]>> = {
  commercial_invoice: ["document_number", "po_number", "currency", "seller_name", "buyer_name", "total_amount", "incoterm"],
  packing_list: ["po_number", "seller_name", "consignee_name", "gross_weight_kg", "container_numbers"],
  bill_of_lading: ["bill_number", "seller_name", "consignee_name", "port_of_loading", "port_of_discharge", "container_numbers", "shipment_date"],
};

const LEGAL_SUFFIXES = /\b(co|company|corp|corporation|inc|incorporated|llc|ltd|limited|gmbh|sa|sas|bv|plc|pte|pty|srl|spa)\b\.?/g;

export function normalizePartyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,&'"()]/g, " ")
    .replace(LEGAL_SUFFIXES, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** ISO 6346 check digit validation for container numbers such as MSCU1234565. */
export function isValidContainerNumber(raw: string): boolean {
  const code = raw.replace(/\s|-/g, "").toUpperCase();
  if (!/^[A-Z]{3}[UJZ]\d{7}$/.test(code)) return false;
  const letterValue = (c: string): number => {
    let v = 10;
    for (let ch = 65; ch <= c.charCodeAt(0); ch++) {
      if (ch === c.charCodeAt(0)) return v;
      v++;
      if (v % 11 === 0) v++;
    }
    return v;
  };
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = code[i]!;
    const v = i < 4 ? letterValue(ch) : Number(ch);
    sum += v * 2 ** i;
  }
  return (sum % 11) % 10 === Number(code[10]);
}

export function parseContainerList(value: string): string[] {
  return value
    .split(/[,;\s]+/)
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean)
    .sort();
}

function field(doc: ExtractedDocument, key: FieldKey): ExtractedField | undefined {
  return doc.fields.find((f) => f.key === key);
}

function side(doc: ExtractedDocument, f: ExtractedField | undefined): FindingSide {
  return { documentId: doc.documentId, versionId: doc.versionId, documentType: doc.type, value: f?.value ?? null, span: f?.span ?? null };
}

function agreementSide(value: string): FindingSide {
  return { documentId: null, versionId: null, documentType: "agreement", value, span: null };
}

function withinBps(expected: number, actual: number, bps: number): boolean {
  if (expected === 0) return actual === 0;
  return Math.abs(actual - expected) * 10_000 <= Math.abs(expected) * bps;
}

function safeAmount(value: string | null | undefined): bigint | null {
  if (!value) return null;
  try {
    return parseAmount(value);
  } catch {
    return null;
  }
}

function parseDate(value: string | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

export interface ReconcileInput {
  terms: DealTerms;
  documents: ExtractedDocument[];
  /** Bill numbers already used by other deals, for reuse detection. */
  knownBillNumbers?: ReadonlyMap<string, string>;
}

/**
 * Deterministic cross-document checks. Severity comes from the rule, never from a model; the
 * confidence is the lower confidence of the extracted values involved.
 */
export function reconcile({ terms, documents, knownBillNumbers }: ReconcileInput): Finding[] {
  const findings: Finding[] = [];
  const push = (f: Omit<Finding, "fingerprint">) => {
    const fingerprint = [f.ruleId, f.field, f.expected.documentType, f.actual.documentType].join("|");
    findings.push({ ...f, fingerprint });
  };
  const conf = (...fs: (ExtractedField | undefined)[]) => Math.min(1, ...fs.filter(Boolean).map((f) => f!.confidence));

  const byType = new Map<DocumentType, ExtractedDocument>();
  for (const d of documents) byType.set(d.type, d);
  const invoice = byType.get("commercial_invoice");
  const packing = byType.get("packing_list");
  const bill = byType.get("bill_of_lading") ?? byType.get("airway_bill");

  for (const doc of documents) {
    for (const key of REQUIRED_FIELDS[doc.type] ?? []) {
      if (!field(doc, key)) {
        push({
          ruleId: RULES.requiredField.id,
          field: key,
          severity: "blocking",
          confidence: 1,
          message: `${key.replaceAll("_", " ")} was not found in the ${doc.type.replaceAll("_", " ")}.`,
          expected: agreementSide("present"),
          actual: side(doc, undefined),
        });
      }
    }

    const po = field(doc, "po_number");
    if (po && po.value.trim().toUpperCase() !== terms.poNumber.toUpperCase()) {
      push({
        ruleId: RULES.poNumber.id,
        field: "po_number",
        severity: "blocking",
        confidence: conf(po),
        message: `PO number ${po.value} does not match agreement PO ${terms.poNumber}.`,
        expected: agreementSide(terms.poNumber),
        actual: side(doc, po),
      });
    }

    const currency = field(doc, "currency");
    if (currency && currency.value.toUpperCase() !== terms.asset.currency.toUpperCase()) {
      push({
        ruleId: RULES.currency.id,
        field: "currency",
        severity: "blocking",
        confidence: conf(currency),
        message: `Document currency ${currency.value} differs from agreement currency ${terms.asset.currency}.`,
        expected: agreementSide(terms.asset.currency),
        actual: side(doc, currency),
      });
    }

    for (const [key, party] of [["seller_name", terms.supplier], ["buyer_name", terms.buyer]] as const) {
      const f = field(doc, key);
      if (f && normalizePartyName(f.value) !== normalizePartyName(party.legalName)) {
        push({
          ruleId: RULES.party.id,
          field: key,
          severity: "warning",
          confidence: conf(f),
          message: `${key === "seller_name" ? "Seller" : "Buyer"} "${f.value}" does not match "${party.legalName}".`,
          expected: agreementSide(party.legalName),
          actual: side(doc, f),
        });
      }
    }

    const incoterm = field(doc, "incoterm");
    if (incoterm) {
      const [rule = "", ...placeParts] = incoterm.value.trim().split(/\s+/);
      const place = (field(doc, "incoterm_place")?.value ?? placeParts.join(" ")).trim();
      const expectedRule = terms.goods.incoterm.rule;
      const expectedPlace = terms.goods.incoterm.namedPlace;
      if (rule.toUpperCase() !== expectedRule || (place && place.toLowerCase() !== expectedPlace.toLowerCase())) {
        push({
          ruleId: RULES.incoterm.id,
          field: "incoterm",
          severity: "blocking",
          confidence: conf(incoterm),
          message: `Incoterms® ${incoterm.value} differs from agreed ${expectedRule} ${expectedPlace}.`,
          expected: agreementSide(`${expectedRule} ${expectedPlace}`),
          actual: side(doc, incoterm),
        });
      }
    }

    for (const [key, expected] of [["port_of_loading", terms.goods.originPort], ["port_of_discharge", terms.goods.destinationPort]] as const) {
      const f = field(doc, key);
      if (f && !f.value.toLowerCase().includes(expected.toLowerCase().split(",")[0]!.trim())) {
        push({
          ruleId: RULES.port.id,
          field: key,
          severity: "warning",
          confidence: conf(f),
          message: `${key === "port_of_loading" ? "Port of loading" : "Port of discharge"} "${f.value}" differs from agreed "${expected}".`,
          expected: agreementSide(expected),
          actual: side(doc, f),
        });
      }
    }

    const containers = field(doc, "container_numbers");
    if (containers) {
      for (const c of parseContainerList(containers.value)) {
        if (!isValidContainerNumber(c)) {
          push({
            ruleId: RULES.containerCheckDigit.id,
            field: `container_numbers:${c}`,
            severity: "blocking",
            confidence: conf(containers),
            message: `Container ${c} fails the ISO 6346 check digit; it is likely mistyped.`,
            expected: agreementSide("valid ISO 6346 number"),
            actual: side(doc, containers),
          });
        }
      }
    }
  }

  if (invoice) {
    const expectedTotal = BigInt(terms.totalUnits);
    const totalField = field(invoice, "total_amount");
    const invoiceTotal = safeAmount(totalField?.value);
    if (totalField && invoiceTotal !== null && invoiceTotal !== expectedTotal) {
      push({
        ruleId: RULES.invoiceTotal.id,
        field: "total_amount",
        severity: "blocking",
        confidence: conf(totalField),
        message: `Invoice total ${formatAmount(invoiceTotal)} differs from agreement total ${formatAmount(expectedTotal)}.`,
        expected: agreementSide(formatAmount(expectedTotal)),
        actual: side(invoice, totalField),
      });
    }

    let lineSum = 0n;
    let allLinesPriced = invoice.lineItems.length > 0;
    for (const li of invoice.lineItems) {
      const unit = safeAmount(li.unitPrice);
      const total = safeAmount(li.lineTotal);
      if (unit === null || total === null) {
        allLinesPriced = false;
        continue;
      }
      lineSum += total;
      if (unit * BigInt(li.quantity) !== total) {
        push({
          ruleId: RULES.lineArithmetic.id,
          field: `line:${li.sku}`,
          severity: "blocking",
          confidence: 1,
          message: `Line ${li.sku}: ${li.quantity} × ${li.unitPrice} ≠ ${li.lineTotal}.`,
          expected: { ...agreementSide(formatAmount(unit * BigInt(li.quantity))), documentType: "commercial_invoice", documentId: invoice.documentId, versionId: invoice.versionId },
          actual: { documentId: invoice.documentId, versionId: invoice.versionId, documentType: invoice.type, value: li.lineTotal, span: li.span },
        });
      }
    }
    if (allLinesPriced && invoiceTotal !== null && lineSum !== invoiceTotal) {
      push({
        ruleId: RULES.lineArithmetic.id,
        field: "total_amount:sum",
        severity: "blocking",
        confidence: conf(totalField),
        message: `Invoice lines sum to ${formatAmount(lineSum)} but the stated total is ${formatAmount(invoiceTotal)}.`,
        expected: { documentId: invoice.documentId, versionId: invoice.versionId, documentType: invoice.type, value: formatAmount(lineSum), span: null },
        actual: side(invoice, totalField),
      });
    }
  }

  const qtySources: ExtractedDocument[] = [invoice, packing].filter((d): d is ExtractedDocument => Boolean(d));
  for (const termLine of terms.goods.lineItems) {
    for (const doc of qtySources) {
      const li = doc.lineItems.find((l) => l.sku.toUpperCase() === termLine.sku.toUpperCase());
      if (!li) {
        push({
          ruleId: RULES.quantity.id,
          field: `qty:${termLine.sku}`,
          severity: "blocking",
          confidence: 1,
          message: `Line ${termLine.sku} is missing from the ${doc.type.replaceAll("_", " ")}.`,
          expected: agreementSide(String(termLine.quantity)),
          actual: { documentId: doc.documentId, versionId: doc.versionId, documentType: doc.type, value: null, span: null },
        });
        continue;
      }
      const lineConfidence = li.method === "model" ? (li.confidence ?? 0) : 1;
      // A model reading may raise a mismatch but must never be what clears one: a person confirms it.
      if (li.method === "model") {
        push({
          ruleId: RULES.modelQuantity.id,
          field: `model-qty:${termLine.sku}`,
          severity: "blocking",
          confidence: lineConfidence,
          message: `${termLine.sku} quantity (${li.quantity} ${li.uom}) on the ${doc.type.replaceAll("_", " ")} was read by a model from a scan. Confirm it against the original before evidence can be bundled.`,
          expected: agreementSide(String(termLine.quantity)),
          actual: { documentId: doc.documentId, versionId: doc.versionId, documentType: doc.type, value: String(li.quantity), span: li.span },
        });
      }
      if (!withinBps(termLine.quantity, li.quantity, terms.tolerances.quantityBps)) {
        push({
          ruleId: RULES.quantity.id,
          field: `qty:${termLine.sku}`,
          severity: "blocking",
          confidence: lineConfidence,
          message: `${doc.type === "packing_list" ? "Packing list" : "Invoice"} shows ${li.quantity} ${li.uom} of ${termLine.sku}; agreement and invoice require ${termLine.quantity} (tolerance ${(terms.tolerances.quantityBps / 100).toFixed(2)}%).`,
          expected: agreementSide(String(termLine.quantity)),
          actual: { documentId: doc.documentId, versionId: doc.versionId, documentType: doc.type, value: String(li.quantity), span: li.span },
        });
      }
    }
  }

  if (packing && bill) {
    const pw = field(packing, "gross_weight_kg");
    const bw = field(bill, "gross_weight_kg");
    if (pw && bw && !withinBps(Number(pw.value), Number(bw.value), terms.tolerances.weightBps)) {
      push({
        ruleId: RULES.weight.id,
        field: "gross_weight_kg",
        severity: "warning",
        confidence: conf(pw, bw),
        message: `Gross weight ${pw.value} kg on packing list vs ${bw.value} kg on bill of lading exceeds ${(terms.tolerances.weightBps / 100).toFixed(2)}% tolerance.`,
        expected: side(packing, pw),
        actual: side(bill, bw),
      });
    }

    const pc = field(packing, "container_numbers");
    const bc = field(bill, "container_numbers");
    if (pc && bc && parseContainerList(pc.value).join(",") !== parseContainerList(bc.value).join(",")) {
      push({
        ruleId: RULES.container.id,
        field: "container_numbers",
        severity: "blocking",
        confidence: conf(pc, bc),
        message: `Containers on packing list (${pc.value}) differ from bill of lading (${bc.value}).`,
        expected: side(packing, pc),
        actual: side(bill, bc),
      });
    }

    const consignee = field(bill, "consignee_name") ?? field(packing, "consignee_name");
    if (!consignee) {
      push({
        ruleId: RULES.consignee.id,
        field: "consignee_name",
        severity: "blocking",
        confidence: 1,
        message: "No consignee is named on the transport documents.",
        expected: agreementSide(terms.buyer.legalName),
        actual: side(bill, undefined),
      });
    }
  }

  if (invoice && bill) {
    const invDate = parseDate(field(invoice, "document_date")?.value);
    const shipDate = field(bill, "shipment_date");
    const shipped = parseDate(shipDate?.value);
    if (invDate !== null && shipped !== null && shipped < invDate - 30 * 86_400_000) {
      push({
        ruleId: RULES.dates.id,
        field: "shipment_date",
        severity: "warning",
        confidence: conf(shipDate),
        message: "Shipment date is more than 30 days before the invoice date.",
        expected: side(invoice, field(invoice, "document_date")),
        actual: side(bill, shipDate),
      });
    }
  }

  const seen = new Map<string, ExtractedDocument>();
  for (const doc of documents) {
    const prior = seen.get(doc.sha256);
    if (prior && prior.type !== doc.type) {
      push({
        ruleId: RULES.duplicate.id,
        field: "sha256",
        severity: "blocking",
        confidence: 1,
        message: `The same file was submitted as both ${prior.type.replaceAll("_", " ")} and ${doc.type.replaceAll("_", " ")}.`,
        expected: { documentId: prior.documentId, versionId: prior.versionId, documentType: prior.type, value: prior.sha256, span: null },
        actual: { documentId: doc.documentId, versionId: doc.versionId, documentType: doc.type, value: doc.sha256, span: null },
      });
    }
    seen.set(doc.sha256, doc);
  }
  const billNo = bill ? field(bill, "bill_number") : undefined;
  const reusedBy = billNo ? knownBillNumbers?.get(billNo.value.toUpperCase()) : undefined;
  if (bill && billNo && reusedBy) {
    push({
      ruleId: RULES.duplicate.id,
      field: "bill_number",
      severity: "blocking",
      confidence: conf(billNo),
      message: `Bill number ${billNo.value} is already used on deal ${reusedBy}.`,
      expected: agreementSide("unused bill number"),
      actual: side(bill, billNo),
    });
  }

  return findings;
}

export function blockingCount(findings: readonly { severity: Severity }[]): number {
  return findings.filter((f) => f.severity === "blocking").length;
}
