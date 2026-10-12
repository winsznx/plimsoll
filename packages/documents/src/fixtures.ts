import { isValidContainerNumber } from "@plimsoll/domain";
import { renderTradeDocument, type RenderSpec } from "./render";

const DISCLAIMER = "SAMPLE FIXTURE · synthetic document generated for the Plimsoll testnet demo · not a real commercial or transport document";

function withCheckDigit(prefix10: string): string {
  for (let d = 0; d <= 9; d++) if (isValidContainerNumber(`${prefix10}${d}`)) return `${prefix10}${d}`;
  throw new Error(`No check digit for ${prefix10}`);
}

/** The canonical PL-2048 scenario: ceramic tiles, Ningbo → Felixstowe, FOB Ningbo. */
export const CANONICAL = {
  reference: "PL-2048",
  poNumber: "PO-88231",
  buyer: "Northbank Home Supply Ltd",
  buyerAddress: "14 Wharf Road, Ipswich IP3 0AB, United Kingdom",
  supplier: "Kestrel Ceramics Co., Ltd.",
  supplierAddress: "88 Yinxian Avenue, Ningbo 315100, China",
  forwarder: "Meridian Freight Partners",
  inspector: "Tidewater Inspection Services",
  resolver: "Harbour Arbitration Desk",
  incoterm: "FOB",
  namedPlace: "Ningbo",
  originPort: "Ningbo",
  destinationPort: "Felixstowe",
  currency: "USD",
  vessel: "MAERSK EDMONTON",
  voyage: "441W",
  billNumber: "MFPNGB2610447",
  invoiceNumber: "KC-INV-26-0917",
  invoiceDate: "2026-10-02",
  shippedOnBoard: "2026-10-06",
  containers: [withCheckDigit("MSKU482610"), withCheckDigit("MSKU482611")],
  lines: [
    { sku: "KC-TILE-60", description: "Porcelain floor tile 600x600 matt", quantity: 320, uom: "cartons", unitPrice: "285.00", total: "91200.00", grossKg: "10560" },
    { sku: "KC-TILE-30", description: "Porcelain wall tile 300x600 gloss", quantity: 160, uom: "cartons", unitPrice: "358.75", total: "57400.00", grossKg: "5280" },
  ],
  total: "148600.00",
  grossWeightKg: "15840",
  shortShippedQuantity: 148,
} as const;

const fmt = (n: string) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function commercialInvoiceSpec(): RenderSpec {
  const c = CANONICAL;
  return {
    title: "Commercial Invoice",
    issuer: `${c.supplier} · ${c.supplierAddress}`,
    fields: [
      ["Invoice No", c.invoiceNumber],
      ["Invoice Date", c.invoiceDate],
      ["PO Number", c.poNumber],
      ["Seller", c.supplier],
      ["Buyer", c.buyer],
      ["Consignee", c.buyer],
      ["Currency", c.currency],
      ["Incoterms", `${c.incoterm} ${c.namedPlace}`],
      ["Port of Loading", c.originPort],
      ["Port of Discharge", c.destinationPort],
    ],
    table: {
      columns: [
        { label: "SKU", x: 48 },
        { label: "Description", x: 128 },
        { label: "Qty", x: 318 },
        { label: "UOM", x: 356 },
        { label: "Unit Price", x: 408 },
        { label: "Amount", x: 478 },
      ],
      rows: c.lines.map((l) => [l.sku, l.description, String(l.quantity), l.uom, fmt(l.unitPrice), fmt(l.total)]),
    },
    footerFields: [["Total Amount", `USD ${fmt(c.total)}`]],
    disclaimer: DISCLAIMER,
  };
}

export function packingListSpec(corrected: boolean): RenderSpec {
  const c = CANONICAL;
  const lines = c.lines.map((l, i) => (i === 1 && !corrected ? { ...l, quantity: c.shortShippedQuantity } : l));
  const cartons = lines.reduce((a, l) => a + l.quantity, 0);
  return {
    title: "Packing List",
    issuer: `${c.supplier} · ${c.supplierAddress}`,
    fields: [
      ["Packing List No", `KC-PL-26-0917${corrected ? "-R1" : ""}`],
      ["Date", corrected ? "2026-10-07" : "2026-10-03"],
      ["PO Number", c.poNumber],
      ["Seller", c.supplier],
      ["Consignee", c.buyer],
      ["Containers", c.containers.join(", ")],
      ["Total Cartons", String(cartons)],
      ["Gross Weight (kg)", c.grossWeightKg],
    ],
    table: {
      columns: [
        { label: "SKU", x: 48 },
        { label: "Description", x: 128 },
        { label: "Qty", x: 338 },
        { label: "UOM", x: 380 },
        { label: "Gross kg", x: 450 },
      ],
      rows: lines.map((l) => [l.sku, l.description, String(l.quantity), l.uom, l.grossKg]),
    },
    footerFields: corrected ? [["Revision", "R1 corrects KC-TILE-30 count to 160 cartons"]] : [],
    disclaimer: DISCLAIMER,
  };
}

export function billOfLadingSpec(overrides: { billNumber?: string } = {}): RenderSpec {
  const c = CANONICAL;
  return {
    title: "Bill of Lading",
    issuer: `${c.forwarder} as agent for the carrier · COPY, NON-NEGOTIABLE`,
    fields: [
      ["B/L No", overrides.billNumber ?? c.billNumber],
      ["Shipper", c.supplier],
      ["Consignee", c.buyer],
      ["Notify Party", c.buyer],
      ["Vessel", c.vessel],
      ["Voyage", c.voyage],
      ["Port of Loading", c.originPort],
      ["Port of Discharge", c.destinationPort],
      ["Containers", c.containers.join(", ")],
      ["Gross Weight (kg)", c.grossWeightKg],
      ["Shipped on Board", c.shippedOnBoard],
    ],
    disclaimer: DISCLAIMER,
  };
}

export async function renderCanonicalFixtures(): Promise<Record<string, Uint8Array>> {
  return {
    "commercial-invoice.pdf": await renderTradeDocument(commercialInvoiceSpec()),
    "packing-list-v1-short.pdf": await renderTradeDocument(packingListSpec(false)),
    "packing-list-v2-corrected.pdf": await renderTradeDocument(packingListSpec(true)),
    "bill-of-lading-copy.pdf": await renderTradeDocument(billOfLadingSpec()),
  };
}
