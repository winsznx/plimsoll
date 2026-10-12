import { DIGEST_DOMAINS, domainDigest, type Canonical } from "./digest";

export type NetworkId = "testnet" | "mainnet" | "local";

export const DOCUMENT_TYPES = [
  "purchase_order",
  "commercial_invoice",
  "proforma_invoice",
  "packing_list",
  "bill_of_lading",
  "airway_bill",
  "inspection_certificate",
  "certificate_of_origin",
  "booking_confirmation",
  "delivery_receipt",
  "insurance_certificate",
  "other",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  purchase_order: "Purchase order",
  commercial_invoice: "Commercial invoice",
  proforma_invoice: "Pro-forma invoice",
  packing_list: "Packing list",
  bill_of_lading: "Bill of lading (copy)",
  airway_bill: "Air waybill (copy)",
  inspection_certificate: "Inspection certificate",
  certificate_of_origin: "Certificate of origin",
  booking_confirmation: "Booking confirmation",
  delivery_receipt: "Delivery receipt",
  insurance_certificate: "Insurance certificate (copy)",
  other: "Other attachment",
};

export const INCOTERM_RULES = ["EXW", "FCA", "CPT", "CIP", "DAP", "DPU", "DDP", "FAS", "FOB", "CFR", "CIF"] as const;
export type IncotermRule = (typeof INCOTERM_RULES)[number];

export type ApproverRole = "buyer" | "supplier" | "inspector" | "forwarder";

export interface TermsParty {
  orgId: string;
  legalName: string;
  address: string;
}

export interface TermsLineItem {
  sku: string;
  description: string;
  quantity: number;
  uom: string;
  unitPriceUnits: string;
  totalUnits: string;
}

export interface TermsApprover {
  address: string;
  role: ApproverRole;
  name: string;
}

export interface TermsMilestone {
  ordinal: number;
  name: string;
  condition: string;
  amountUnits: string;
  payee: string;
  approvers: TermsApprover[];
  quorum: number;
  /** Unix seconds after which unreleased, undisputed funds may be refunded; 0 disables. */
  refundAfter: number;
  requiredDocuments: DocumentType[];
}

export interface DealTerms {
  schema: "plimsoll.terms.v1";
  dealId: string;
  reference: string;
  poNumber: string;
  network: NetworkId;
  asset: { code: string; issuer: string; contractId: string; currency: string };
  buyer: TermsParty;
  supplier: TermsParty;
  resolver: { name: string; address: string };
  goods: {
    lineItems: TermsLineItem[];
    incoterm: { rule: IncotermRule; namedPlace: string; edition: string };
    transportMode: "sea" | "air" | "road" | "rail";
    originPort: string;
    destinationPort: string;
  };
  governingLaw: string;
  disputeForum: string;
  totalUnits: string;
  fundingDeadline: number;
  tolerances: { quantityBps: number; weightBps: number };
  milestones: TermsMilestone[];
}

export async function termsDigest(terms: DealTerms): Promise<string> {
  return domainDigest(DIGEST_DOMAINS.terms, terms as unknown as Canonical);
}

/** The 32-byte on-chain deal identifier derived from the database UUID. */
export async function dealIdDigest(dealId: string): Promise<string> {
  return domainDigest(DIGEST_DOMAINS.deal, dealId);
}

export async function disputeReasonDigest(reason: { dealId: string; milestoneOrdinal: number; reason: string; openedBy: string }): Promise<string> {
  return domainDigest(DIGEST_DOMAINS.dispute, reason);
}

export interface TermsValidationIssue {
  path: string;
  message: string;
}

export function validateTerms(terms: DealTerms): TermsValidationIssue[] {
  const issues: TermsValidationIssue[] = [];
  const total = BigInt(terms.totalUnits);
  if (total <= 0n) issues.push({ path: "totalUnits", message: "Agreement total must be positive." });

  const lineSum = terms.goods.lineItems.reduce((acc, li) => acc + BigInt(li.totalUnits), 0n);
  if (terms.goods.lineItems.length === 0) issues.push({ path: "goods.lineItems", message: "At least one line item is required." });
  if (lineSum !== total) issues.push({ path: "goods.lineItems", message: "Line items must sum exactly to the agreement total." });
  terms.goods.lineItems.forEach((li, i) => {
    if (!Number.isInteger(li.quantity) || li.quantity <= 0) issues.push({ path: `goods.lineItems.${i}.quantity`, message: "Quantity must be a positive whole number." });
    if (BigInt(li.unitPriceUnits) * BigInt(li.quantity) !== BigInt(li.totalUnits)) {
      issues.push({ path: `goods.lineItems.${i}.totalUnits`, message: `Line ${li.sku}: quantity × unit price does not equal the line total.` });
    }
  });

  const milestoneSum = terms.milestones.reduce((acc, m) => acc + BigInt(m.amountUnits), 0n);
  if (terms.milestones.length === 0 || terms.milestones.length > 12) issues.push({ path: "milestones", message: "Between 1 and 12 milestones are required." });
  if (milestoneSum !== total) issues.push({ path: "milestones", message: "Milestone amounts must sum exactly to the agreement total." });
  terms.milestones.forEach((m, i) => {
    if (BigInt(m.amountUnits) <= 0n) issues.push({ path: `milestones.${i}.amountUnits`, message: "Milestone amount must be positive." });
    const unique = new Set(m.approvers.map((a) => a.address));
    if (unique.size !== m.approvers.length) issues.push({ path: `milestones.${i}.approvers`, message: "An approver appears twice." });
    if (m.approvers.length === 0 || m.approvers.length > 8) issues.push({ path: `milestones.${i}.approvers`, message: "Between 1 and 8 approvers are required." });
    if (m.quorum < 1 || m.quorum > m.approvers.length) issues.push({ path: `milestones.${i}.quorum`, message: "Quorum must be between 1 and the number of approvers." });
  });

  if (terms.buyer.address === terms.supplier.address) issues.push({ path: "supplier.address", message: "Buyer and supplier must use different signing addresses." });
  if (!terms.resolver.address) issues.push({ path: "resolver", message: "A named resolver is required; there is no default arbitrator." });
  if (!terms.governingLaw.trim()) issues.push({ path: "governingLaw", message: "Governing law must be stated explicitly." });
  if (!terms.goods.incoterm.namedPlace.trim()) issues.push({ path: "goods.incoterm.namedPlace", message: "Incoterms® rules require a named place." });
  return issues;
}
