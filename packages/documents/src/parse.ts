import type { DocumentType, ExtractedField, ExtractedLineItem, FieldKey, SourceSpan } from "@plimsoll/domain";
import type { DocLine } from "./lines";

const AMOUNT = "([\\d,]+(?:\\.\\d+)?)";

const FIELD_PATTERNS: { key: FieldKey; pattern: RegExp }[] = [
  { key: "po_number", pattern: /^(?:buyer'?s?\s+)?(?:p\.?\s?o\.?|purchase order)\s*(?:no\.?|number|ref(?:erence)?|#)?\s*[:#]\s*(.+)$/i },
  { key: "bill_number", pattern: /^(?:b\/l|bill of lading|air ?way ?bill|awb)\s*(?:no\.?|number|#)\s*[:#]?\s*(.+)$/i },
  { key: "document_number", pattern: /^(?:invoice|packing list|document|certificate)\s*(?:no\.?|number|#)\s*[:#]?\s*(.+)$/i },
  { key: "document_date", pattern: /^(?:invoice\s+|document\s+|issue\s+)?date(?:\s+of\s+issue)?\s*:\s*(.+)$/i },
  { key: "currency", pattern: /^currency\s*:\s*([A-Z]{3})\b/i },
  { key: "seller_name", pattern: /^(?:seller|exporter|shipper|supplier|beneficiary)\s*:\s*(.+)$/i },
  { key: "buyer_name", pattern: /^(?:buyer|importer|sold to|bill to)\s*:\s*(.+)$/i },
  { key: "consignee_name", pattern: /^consignee\s*:\s*(.+)$/i },
  { key: "total_amount", pattern: new RegExp(`^(?:invoice\\s+)?total(?:\\s+amount|\\s+value)?(?:\\s*\\(?[A-Z]{3}\\)?)?\\s*:\\s*(?:[A-Z]{3}\\s*)?${AMOUNT}`, "i") },
  { key: "incoterm", pattern: /^(?:incoterms?®?(?:\s*(?:rule|\d{4}))?|terms of delivery|delivery terms)\s*:\s*(.+)$/i },
  { key: "port_of_loading", pattern: /^port of loading\s*:\s*(.+)$/i },
  { key: "port_of_discharge", pattern: /^port of discharge\s*:\s*(.+)$/i },
  { key: "vessel", pattern: /^vessel(?:\s+name)?\s*:\s*(.+)$/i },
  { key: "voyage", pattern: /^voyage(?:\s+no\.?)?\s*:\s*(.+)$/i },
  { key: "container_numbers", pattern: /^containers?(?:\s+(?:no\.?|numbers?))?\s*:\s*(.+)$/i },
  { key: "gross_weight_kg", pattern: new RegExp(`^(?:total\\s+)?gross\\s+weight(?:\\s*\\(kg\\))?\\s*:\\s*${AMOUNT}`, "i") },
  { key: "total_packages", pattern: /^(?:total\s+)?(?:packages|cartons|pallets)\s*:\s*(\d+)/i },
  { key: "shipment_date", pattern: /^(?:shipped on board(?:\s+date)?|on board date|shipment date|date of shipment)\s*:\s*(.+)$/i },
];

const TYPE_SIGNALS: { type: DocumentType; pattern: RegExp }[] = [
  { type: "proforma_invoice", pattern: /pro[\s-]?forma\s+invoice/i },
  { type: "commercial_invoice", pattern: /commercial\s+invoice|^invoice$/i },
  { type: "packing_list", pattern: /packing\s+list/i },
  { type: "bill_of_lading", pattern: /bill\s+of\s+lading/i },
  { type: "airway_bill", pattern: /air\s?way\s?bill/i },
  { type: "purchase_order", pattern: /purchase\s+order$/i },
  { type: "inspection_certificate", pattern: /inspection\s+certificate|certificate\s+of\s+inspection/i },
  { type: "certificate_of_origin", pattern: /certificate\s+of\s+origin/i },
  { type: "booking_confirmation", pattern: /booking\s+confirmation/i },
  { type: "delivery_receipt", pattern: /delivery\s+receipt|proof\s+of\s+delivery/i },
  { type: "insurance_certificate", pattern: /insurance\s+certificate/i },
];

export function classifyDocument(lines: DocLine[]): { type: DocumentType; confidence: number } {
  for (const line of lines.slice(0, 8)) {
    for (const s of TYPE_SIGNALS) if (s.pattern.test(line.text.trim())) return { type: s.type, confidence: 0.95 };
  }
  for (const line of lines) {
    for (const s of TYPE_SIGNALS) if (s.pattern.test(line.text)) return { type: s.type, confidence: 0.6 };
  }
  return { type: "other", confidence: 0.2 };
}

function spanOf(line: DocLine, text = line.text): SourceSpan {
  return { page: line.page, bbox: line.bbox, text };
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const HEADER_ALIASES: Record<string, keyof ExtractedLineItem | "skip"> = {
  sku: "sku",
  item: "sku",
  "item code": "sku",
  code: "sku",
  description: "description",
  goods: "description",
  qty: "quantity",
  quantity: "quantity",
  uom: "uom",
  unit: "uom",
  units: "uom",
  "unit price": "unitPrice",
  price: "unitPrice",
  amount: "lineTotal",
  total: "lineTotal",
  "line total": "lineTotal",
  "gross kg": "grossWeightKg",
  "gross weight": "grossWeightKg",
  "gross wt": "grossWeightKg",
};

function headerKey(text: string): keyof ExtractedLineItem | "skip" | undefined {
  const t = text.toLowerCase().replace(/[().:]/g, "").replace(/\s*\b(usd|eur|gbp|kg)\b\s*/g, (m) => (m.trim() === "kg" ? " kg" : "")).trim();
  return HEADER_ALIASES[t] ?? (t.startsWith("unit price") ? "unitPrice" : t.startsWith("gross") ? "grossWeightKg" : undefined);
}

function toNumberString(text: string): string | null {
  const m = /-?[\d,]+(?:\.\d+)?/.exec(text);
  return m ? m[0].replaceAll(",", "") : null;
}

/** Each field is taken from the first line that matches its label; tables are parsed by header. */
export function extractFields(lines: DocLine[]): { fields: ExtractedField[]; lineItems: ExtractedLineItem[] } {
  const fields: ExtractedField[] = [];
  const seen = new Set<FieldKey>();

  for (const line of lines) {
    const candidates = line.cells.length > 1 ? [line.text, ...line.cells.map((c) => c.text), ...pairCells(line)] : [line.text];
    for (const candidate of candidates) {
      for (const { key, pattern } of FIELD_PATTERNS) {
        if (seen.has(key)) continue;
        const m = pattern.exec(candidate.trim());
        if (!m?.[1]) continue;
        let value = clean(m[1]);
        if (key === "total_amount" || key === "gross_weight_kg") value = value.replaceAll(",", "");
        fields.push({ key, value, span: spanOf(line, candidate.trim()), confidence: 0.98, method: "rule" });
        seen.add(key);
      }
    }
  }

  return { fields, lineItems: extractTable(lines) };
}

/** "Label:" and value rendered as two separate cells on one row. */
function pairCells(line: DocLine): string[] {
  const out: string[] = [];
  for (let i = 0; i < line.cells.length - 1; i++) {
    if (line.cells[i]!.text.trim().endsWith(":")) out.push(`${line.cells[i]!.text} ${line.cells[i + 1]!.text}`);
  }
  return out;
}

function extractTable(lines: DocLine[]): ExtractedLineItem[] {
  const headerIndex = lines.findIndex((l) => {
    const keys = l.cells.map((c) => headerKey(c.text));
    return keys.includes("sku") && keys.includes("quantity");
  });
  if (headerIndex === -1) return [];
  const header = lines[headerIndex]!;
  const columns = header.cells.map((c) => ({ key: headerKey(c.text), x: c.x }));
  const items: ExtractedLineItem[] = [];

  for (const line of lines.slice(headerIndex + 1)) {
    if (line.page !== header.page && items.length > 0 && line.cells.length < 3) break;
    if (line.cells.length < 3) {
      if (items.length > 0) break;
      continue;
    }
    const row: Partial<Record<keyof ExtractedLineItem, string>> = {};
    for (const cell of line.cells) {
      const col = columns.reduce((best, c) => (Math.abs(c.x - cell.x) < Math.abs(best.x - cell.x) ? c : best), columns[0]!);
      if (col.key && col.key !== "skip" && col.key !== "span") row[col.key] = row[col.key] ? `${row[col.key]} ${cell.text}` : cell.text;
    }
    const qty = row.quantity ? toNumberString(row.quantity) : null;
    if (!row.sku || qty === null || !/^[A-Z0-9][A-Z0-9-/.]{1,}$/i.test(row.sku.trim())) {
      if (items.length > 0) break;
      continue;
    }
    items.push({
      sku: row.sku.trim(),
      description: clean(row.description ?? ""),
      quantity: Math.round(Number(qty)),
      uom: clean(row.uom ?? "units"),
      unitPrice: row.unitPrice ? toNumberString(row.unitPrice) : null,
      lineTotal: row.lineTotal ? toNumberString(row.lineTotal) : null,
      grossWeightKg: row.grossWeightKg ? toNumberString(row.grossWeightKg) : null,
      span: spanOf(line),
    });
  }
  return items;
}
