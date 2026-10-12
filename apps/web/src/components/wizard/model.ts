import {
  DOCUMENT_TYPE_LABELS,
  INCOTERM_RULES,
  formatAmount,
  parseAmount,
  splitByBasisPoints,
  type ApproverRole,
  type DealTerms,
  type DocumentType,
  type IncotermRule,
} from "@plimsoll/domain";
import type { DraftInput } from "@/server/services/deals";

/**
 * Wizard state keeps every field as the string the user typed so partially entered values
 * survive autosave; conversion to the API's DraftInput happens once, in toDraftInput.
 */
export interface PartyInput {
  appointed: boolean;
  name: string;
  address: string;
}

export interface SupplierInput {
  mode: "existing" | "new";
  orgId: string;
  legalName: string;
  contact: "address" | "invite";
  signingAddress: string;
  inviteEmail: string;
}

export interface LineItemInput {
  key: string;
  sku: string;
  description: string;
  quantity: string;
  uom: string;
  unitPrice: string;
}

export interface MilestoneInput {
  key: string;
  name: string;
  condition: string;
  amount: string;
  approverRoles: ApproverRole[];
  quorum: string;
  refundAfterDays: string;
  requiredDocuments: DocumentType[];
}

export type TransportMode = DraftInput["transportMode"];

export interface WizardState {
  title: string;
  poNumber: string;
  supplier: SupplierInput;
  inspector: PartyInput;
  forwarder: PartyInput;
  resolver: PartyInput;
  lineItems: LineItemInput[];
  incotermRule: IncotermRule | "";
  namedPlace: string;
  transportMode: TransportMode | "";
  originPort: string;
  destinationPort: string;
  milestones: MilestoneInput[];
  /** While set, milestone amounts are derived from the goods total so they always sum exactly. */
  autoSplitBps: number[] | null;
  quantityBps: string;
  weightBps: string;
  fundingDeadlineDays: string;
  governingLaw: string;
  disputeForum: string;
}

export interface KnownParty {
  name: string;
  address: string;
}

export interface KnownOrg {
  orgId: string;
  name: string;
  addresses: string[];
  /** Deal references shared with this org, to tell apart organizations with the same name. */
  dealRefs: string[];
}

export interface WizardContext {
  buyer: { legalName: string; address: string | null };
  asset: { code: string; isDemo: boolean; networkLabel: string };
  orgs: KnownOrg[];
  known: { inspector: KnownParty[]; forwarder: KnownParty[]; resolver: KnownParty[] };
}

export const STEPS = ["Parties", "Goods and delivery terms", "Assets and economics", "Releases and quorum", "Documents", "Deadlines and disputes", "Review and create"] as const;
export const REVIEW_STEP = STEPS.length - 1;

export const APPROVER_ROLES: readonly ApproverRole[] = ["buyer", "supplier", "inspector", "forwarder"];
export const TRANSPORT_MODES: readonly TransportMode[] = ["sea", "air", "road", "rail"];
export { DOCUMENT_TYPE_LABELS, INCOTERM_RULES };

/** PRD §3.1 test fixture. A starting point the user edits, not a legal recommendation. */
export const TEMPLATE_BPS = [2000, 6000, 2000];

const ADDRESS = /^G[A-Z2-7]{55}$/;
const AMOUNT = /^\d{1,15}(\.\d{1,7})?$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WHOLE = /^\d+$/;

let keySeq = 0;
export function rowKey(prefix: string): string {
  keySeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${keySeq}`;
}

export function emptyLineItem(): LineItemInput {
  return { key: rowKey("li"), sku: "", description: "", quantity: "", uom: "cartons", unitPrice: "" };
}

export function emptyMilestone(): MilestoneInput {
  return { key: rowKey("ms"), name: "", condition: "", amount: "", approverRoles: ["buyer"], quorum: "1", refundAfterDays: "0", requiredDocuments: [] };
}

export function initialState(opts: { hasKnownOrgs: boolean }): WizardState {
  return {
    title: "",
    poNumber: "",
    supplier: { mode: opts.hasKnownOrgs ? "existing" : "new", orgId: "", legalName: "", contact: "address", signingAddress: "", inviteEmail: "" },
    inspector: { appointed: false, name: "", address: "" },
    forwarder: { appointed: false, name: "", address: "" },
    resolver: { appointed: true, name: "", address: "" },
    lineItems: [emptyLineItem()],
    incotermRule: "",
    namedPlace: "",
    transportMode: "",
    originPort: "",
    destinationPort: "",
    milestones: [
      {
        key: rowKey("ms"),
        name: "Purchase confirmed",
        condition: "Both parties signed the terms and escrow is fully funded; the buyer releases the deposit.",
        amount: "",
        approverRoles: ["buyer"],
        quorum: "1",
        refundAfterDays: "0",
        requiredDocuments: [],
      },
      {
        key: rowKey("ms"),
        name: "Carrier handoff",
        condition: "Reconciled commercial invoice, packing list and bill of lading copy, plus approval by the buyer and the appointed independent inspector.",
        amount: "",
        approverRoles: ["buyer", "inspector"],
        quorum: "2",
        refundAfterDays: "0",
        requiredDocuments: ["commercial_invoice", "packing_list", "bill_of_lading"],
      },
      {
        key: rowKey("ms"),
        name: "Receipt acknowledged",
        condition: "Buyer confirms receipt of the goods; if the buyer does not, the named resolver decides under the agreed rules.",
        amount: "",
        approverRoles: ["buyer"],
        quorum: "1",
        refundAfterDays: "120",
        requiredDocuments: [],
      },
    ],
    autoSplitBps: TEMPLATE_BPS,
    quantityBps: "0",
    weightBps: "200",
    fundingDeadlineDays: "14",
    governingLaw: "",
    disputeForum: "",
  };
}

export function safeUnits(value: string): bigint | null {
  if (!AMOUNT.test(value.trim())) return null;
  try {
    return parseAmount(value);
  } catch {
    return null;
  }
}

export function lineTotal(li: LineItemInput): bigint | null {
  const unit = safeUnits(li.unitPrice);
  if (unit === null || !WHOLE.test(li.quantity.trim())) return null;
  return unit * BigInt(li.quantity.trim());
}

export function goodsTotal(s: WizardState): bigint {
  return s.lineItems.reduce((acc, li) => acc + (lineTotal(li) ?? 0n), 0n);
}

/** Plain decimal string the API accepts: no grouping, at most 7 places. */
export function toDecimal(units: bigint): string {
  return formatAmount(units, { grouping: false });
}

export function effectiveAmounts(s: WizardState): string[] {
  const total = goodsTotal(s);
  if (s.autoSplitBps && s.autoSplitBps.length === s.milestones.length && total > 0n) return splitByBasisPoints(total, s.autoSplitBps).map(toDecimal);
  return s.milestones.map((m) => m.amount);
}

/** Freezes derived amounts into the state so the user can edit them directly. */
export function materializeAmounts(s: WizardState): WizardState {
  const amounts = effectiveAmounts(s);
  return { ...s, autoSplitBps: null, milestones: s.milestones.map((m, i) => ({ ...m, amount: amounts[i] ?? m.amount })) };
}

export function bpsLabel(bps: string): string {
  if (!WHOLE.test(bps.trim())) return "-";
  const n = Number(bps.trim());
  return `${Math.floor(n / 100)}.${String(n % 100).padStart(2, "0")}%`;
}

export type StepErrors = Record<string, string>;

function partyErrors(prefix: string, label: string, p: PartyInput, errs: StepErrors): void {
  if (!p.appointed) return;
  if (p.name.trim().length < 2) errs[`${prefix}.name`] = `Enter the ${label}'s name.`;
  if (!ADDRESS.test(p.address.trim())) errs[`${prefix}.address`] = `Enter the ${label}'s Stellar account address (G…, 56 characters).`;
}

function intIn(value: string, min: number, max: number): boolean {
  if (!WHOLE.test(value.trim())) return false;
  const n = Number(value.trim());
  return n >= min && n <= max;
}

/** Validation mirrors the server's draftInput schema and validateTerms, step by step. */
export function validate(s: WizardState, ctx: WizardContext): StepErrors[] {
  const steps: StepErrors[] = STEPS.map(() => ({}));

  const p = steps[0]!;
  if (s.title.trim().length < 3) p.title = "Give the deal a title of at least 3 characters.";
  else if (s.title.trim().length > 120) p.title = "Keep the title under 120 characters.";
  if (!s.poNumber.trim()) p.poNumber = "Enter the purchase order number.";
  else if (s.poNumber.trim().length > 40) p.poNumber = "Keep the PO number under 40 characters.";
  if (s.supplier.mode === "existing" && !s.supplier.orgId) p["supplier.orgId"] = "Choose a counterparty, or switch to a new one.";
  if (s.supplier.legalName.trim().length < 2) p["supplier.legalName"] = "Enter the supplier's registered legal name.";
  if (s.supplier.contact === "address") {
    if (!ADDRESS.test(s.supplier.signingAddress.trim())) p["supplier.signingAddress"] = "Enter the supplier's Stellar signing address (G…, 56 characters).";
    else if (s.supplier.signingAddress.trim() === ctx.buyer.address) p["supplier.signingAddress"] = "The supplier must sign with a different address than you.";
  } else if (!EMAIL.test(s.supplier.inviteEmail.trim())) p["supplier.inviteEmail"] = "Enter the email address the invitation goes to.";
  partyErrors("inspector", "inspector", s.inspector, p);
  partyErrors("forwarder", "forwarder", s.forwarder, p);
  const supplierAddr = s.supplier.contact === "address" ? s.supplier.signingAddress.trim() : "";
  for (const [key, party] of [["inspector", s.inspector], ["forwarder", s.forwarder]] as const) {
    const a = party.address.trim();
    if (!party.appointed || !a || p[`${key}.address`]) continue;
    if (a === ctx.buyer.address || a === supplierAddr) p[`${key}.address`] = `The ${key} must be independent: use an address that is not the buyer's or the supplier's.`;
  }
  if (s.inspector.appointed && s.forwarder.appointed && s.inspector.address.trim() && s.inspector.address.trim() === s.forwarder.address.trim()) p["forwarder.address"] = "Inspector and forwarder cannot share a signing address.";

  const g = steps[1]!;
  if (s.lineItems.length === 0) g.lineItems = "Add at least one line item.";
  if (s.lineItems.length > 50) g.lineItems = "A deal can carry at most 50 line items.";
  s.lineItems.forEach((li, i) => {
    if (!li.sku.trim() || li.sku.trim().length > 40) g[`lineItems.${i}.sku`] = "SKU, 1 to 40 characters.";
    if (!li.description.trim() || li.description.trim().length > 200) g[`lineItems.${i}.description`] = "Describe the goods (up to 200 characters).";
    if (!intIn(li.quantity, 1, 1_000_000_000)) g[`lineItems.${i}.quantity`] = "Whole number above zero.";
    if (!li.uom.trim() || li.uom.trim().length > 20) g[`lineItems.${i}.uom`] = "Unit, e.g. cartons.";
    const unit = safeUnits(li.unitPrice);
    if (unit === null) g[`lineItems.${i}.unitPrice`] = "Plain decimal, up to 7 places, e.g. 2850.00.";
    else if (unit === 0n) g[`lineItems.${i}.unitPrice`] = "Unit price must be above zero.";
  });
  if (!s.incotermRule) g.incotermRule = "Choose the Incoterms® rule both parties agreed.";
  if (s.namedPlace.trim().length < 2) g.namedPlace = "Incoterms® rules need a named place.";
  if (!s.transportMode) g.transportMode = "Choose how the goods travel.";
  if (s.originPort.trim().length < 2) g.originPort = "Enter the origin port or place.";
  if (s.destinationPort.trim().length < 2) g.destinationPort = "Enter the destination port or place.";

  const total = goodsTotal(s);
  const e = steps[2]!;
  if (total === 0n) e.total = "The agreement total is zero. Complete the line items in step 2 first.";
  if (s.milestones.length === 0) e.milestones = "Add at least one milestone.";
  if (s.milestones.length > 12) e.milestones = "At most 12 milestones.";
  const amounts = effectiveAmounts(s);
  let sum = 0n;
  s.milestones.forEach((m, i) => {
    if (m.name.trim().length < 2 || m.name.trim().length > 80) e[`milestones.${i}.name`] = "Name the milestone (2 to 80 characters).";
    const u = safeUnits(amounts[i] ?? "");
    if (u === null) e[`milestones.${i}.amount`] = "Plain decimal, up to 7 places.";
    else if (u === 0n) e[`milestones.${i}.amount`] = "Each milestone must release something.";
    else sum += u;
  });
  if (total > 0n && Object.keys(e).every((k) => !k.endsWith(".amount")) && sum !== total) {
    const diff = total - sum;
    e.milestoneSum = `Milestones add up to ${formatAmount(sum)}; the agreement total is ${formatAmount(total)}. ${diff > 0n ? `Allocate ${formatAmount(diff)} more.` : `Remove ${formatAmount(-diff)}.`}`;
  }

  const r = steps[3]!;
  s.milestones.forEach((m, i) => {
    if (m.condition.trim().length < 2 || m.condition.trim().length > 400) r[`milestones.${i}.condition`] = "State the release condition in plain words (up to 400 characters).";
    if (m.approverRoles.length === 0) r[`milestones.${i}.approverRoles`] = "Choose at least one approver.";
    const missing = m.approverRoles.filter((role) => (role === "inspector" && !s.inspector.appointed) || (role === "forwarder" && !s.forwarder.appointed));
    if (missing.length > 0) r[`milestones.${i}.approverRoles`] = `No ${missing.join(" or ")} is appointed. Appoint one in Parties or remove the role here.`;
    if (!intIn(m.quorum, 1, Math.max(1, m.approverRoles.length))) r[`milestones.${i}.quorum`] = `Quorum must be between 1 and ${Math.max(1, m.approverRoles.length)}.`;
  });

  const d = steps[4]!;
  if (!intIn(s.quantityBps, 0, 2000)) d.quantityBps = "0 to 2000 basis points.";
  if (!intIn(s.weightBps, 0, 2000)) d.weightBps = "0 to 2000 basis points.";

  const x = steps[5]!;
  if (!intIn(s.fundingDeadlineDays, 1, 365)) x.fundingDeadlineDays = "1 to 365 days.";
  s.milestones.forEach((m, i) => {
    if (!intIn(m.refundAfterDays, 0, 730)) x[`milestones.${i}.refundAfterDays`] = "0 to 730 days.";
  });
  if (s.governingLaw.trim().length < 2) x.governingLaw = "State the governing law. Plimsoll does not pick one for you.";
  if (s.disputeForum.trim().length < 2) x.disputeForum = "State the dispute forum. Plimsoll does not pick one for you.";
  partyErrors("resolver", "resolver", { ...s.resolver, appointed: true }, x);
  const resolverAddr = s.resolver.address.trim();
  if (!x["resolver.address"] && [ctx.buyer.address, supplierAddr, s.inspector.appointed ? s.inspector.address.trim() : "", s.forwarder.appointed ? s.forwarder.address.trim() : ""].includes(resolverAddr)) {
    x["resolver.address"] = "The resolver must be independent of every other party on this deal.";
  }

  return steps;
}

export function toDraftInput(s: WizardState): DraftInput {
  if (!s.incotermRule || !s.transportMode) throw new Error("Incoterm rule and transport mode must be chosen before creating the draft.");
  const amounts = effectiveAmounts(s);
  const party = (p: PartyInput) => (p.appointed ? { name: p.name.trim(), address: p.address.trim() } : null);
  return {
    title: s.title.trim(),
    poNumber: s.poNumber.trim(),
    supplier: {
      orgId: s.supplier.mode === "existing" ? s.supplier.orgId : null,
      legalName: s.supplier.legalName.trim(),
      signingAddress: s.supplier.contact === "address" ? s.supplier.signingAddress.trim() : null,
      inviteEmail: s.supplier.contact === "invite" ? s.supplier.inviteEmail.trim() : null,
    },
    lineItems: s.lineItems.map((li) => ({ sku: li.sku.trim(), description: li.description.trim(), quantity: Number(li.quantity.trim()), uom: li.uom.trim(), unitPrice: toDecimal(parseAmount(li.unitPrice)) })),
    incoterm: { rule: s.incotermRule, namedPlace: s.namedPlace.trim() },
    transportMode: s.transportMode,
    originPort: s.originPort.trim(),
    destinationPort: s.destinationPort.trim(),
    governingLaw: s.governingLaw.trim(),
    disputeForum: s.disputeForum.trim(),
    resolver: { name: s.resolver.name.trim(), address: s.resolver.address.trim() },
    inspector: party(s.inspector),
    forwarder: party(s.forwarder),
    fundingDeadlineDays: Number(s.fundingDeadlineDays.trim()),
    tolerances: { quantityBps: Number(s.quantityBps.trim()), weightBps: Number(s.weightBps.trim()) },
    milestones: s.milestones.map((m, i) => ({
      name: m.name.trim(),
      condition: m.condition.trim(),
      amount: toDecimal(parseAmount(amounts[i]!)),
      approverRoles: m.approverRoles,
      quorum: Number(m.quorum.trim()),
      refundAfterDays: Number(m.refundAfterDays.trim()),
      requiredDocuments: m.requiredDocuments,
    })),
  };
}

const DAY = 86_400;

/**
 * Rebuilds wizard state from saved draft terms. Deadlines are stored as absolute timestamps
 * computed at save time, so they convert back to day counts relative to that save.
 */
export function fromTerms(terms: DealTerms, opts: { title: string; savedAt: Date; supplierInviteEmail: string | null; participants: { role: string; name: string; address: string | null }[] }): WizardState {
  const savedAt = Math.floor(opts.savedAt.getTime() / 1000);
  const days = (ts: number) => String(Math.max(0, Math.round((ts - savedAt) / DAY)));
  const party = (role: "inspector" | "forwarder"): PartyInput => {
    const p = opts.participants.find((x) => x.role === role);
    return p ? { appointed: true, name: p.name, address: p.address ?? "" } : { appointed: false, name: "", address: "" };
  };
  const supplierAddress = terms.supplier.address;
  return {
    title: opts.title,
    poNumber: terms.poNumber,
    supplier: {
      mode: "existing",
      orgId: terms.supplier.orgId,
      legalName: terms.supplier.legalName,
      contact: supplierAddress ? "address" : "invite",
      signingAddress: supplierAddress,
      inviteEmail: opts.supplierInviteEmail ?? "",
    },
    inspector: party("inspector"),
    forwarder: party("forwarder"),
    resolver: { appointed: true, name: terms.resolver.name, address: terms.resolver.address },
    lineItems: terms.goods.lineItems.map((li) => ({ key: rowKey("li"), sku: li.sku, description: li.description, quantity: String(li.quantity), uom: li.uom, unitPrice: toDecimal(BigInt(li.unitPriceUnits)) })),
    incotermRule: terms.goods.incoterm.rule,
    namedPlace: terms.goods.incoterm.namedPlace,
    transportMode: terms.goods.transportMode,
    originPort: terms.goods.originPort,
    destinationPort: terms.goods.destinationPort,
    milestones: terms.milestones.map((m) => ({
      key: rowKey("ms"),
      name: m.name,
      condition: m.condition,
      amount: toDecimal(BigInt(m.amountUnits)),
      approverRoles: m.approvers.map((a) => a.role),
      quorum: String(m.quorum),
      refundAfterDays: m.refundAfter > 0 ? days(m.refundAfter) : "0",
      requiredDocuments: m.requiredDocuments,
    })),
    autoSplitBps: null,
    quantityBps: String(terms.tolerances.quantityBps),
    weightBps: String(terms.tolerances.weightBps),
    fundingDeadlineDays: String(Math.min(365, Math.max(1, Math.round((terms.fundingDeadline - savedAt) / DAY)))),
    governingLaw: terms.governingLaw,
    disputeForum: terms.disputeForum,
  };
}

/** Restored autosave data comes from the browser, so it is shape-checked before use. */
export function isWizardState(value: unknown): value is WizardState {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<WizardState>;
  return (
    typeof v.title === "string" &&
    typeof v.poNumber === "string" &&
    Array.isArray(v.lineItems) &&
    Array.isArray(v.milestones) &&
    typeof v.supplier === "object" &&
    v.supplier !== null &&
    (v.supplier.mode === "existing" || v.supplier.mode === "new") &&
    typeof v.resolver === "object" &&
    v.resolver !== null &&
    typeof v.inspector === "object" &&
    typeof v.forwarder === "object" &&
    v.milestones.every((m) => m && typeof m === "object" && Array.isArray(m.approverRoles) && Array.isArray(m.requiredDocuments)) &&
    v.lineItems.every((li) => li && typeof li === "object" && typeof li.unitPrice === "string")
  );
}
