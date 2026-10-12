import type { IncotermRule } from "@plimsoll/domain";
import { percentOf, shortAddress, units } from "@/lib/format";
import { DOCUMENT_TYPE_LABELS, bpsLabel, effectiveAmounts, goodsTotal, safeUnits, type WizardContext, type WizardState } from "./model";

/** Where risk passes under each Incoterms® 2020 rule, phrased for a non-specialist reader. */
const INCOTERM_RISK: Record<IncotermRule, string> = {
  EXW: "the seller makes the goods available at its premises; the buyer carries all transport risk and cost from there",
  FCA: "risk passes when the seller hands the goods to the buyer's carrier at the named place",
  CPT: "the seller pays carriage to the named destination, but risk passes when the goods reach the first carrier",
  CIP: "as CPT, and the seller must also insure the goods in transit (all-risks cover)",
  DAP: "the seller carries the risk until the goods arrive at the named destination, ready for unloading",
  DPU: "the seller carries the risk until the goods are unloaded at the named destination",
  DDP: "the seller carries the risk and pays import duties up to the named destination",
  FAS: "risk passes when the goods are placed alongside the vessel at the named port of shipment",
  FOB: "risk passes when the goods are on board the vessel at the named port of shipment",
  CFR: "the seller pays freight to the destination port, but risk passes once the goods are on board at shipment",
  CIF: "as CFR, and the seller must also insure the goods to the destination port (minimum cover)",
};

const SEA_ONLY: readonly IncotermRule[] = ["FAS", "FOB", "CFR", "CIF"];

function roleList(roles: string[]): string {
  if (roles.length <= 1) return roles.join("");
  return `${roles.slice(0, -1).join(", ")} and ${roles[roles.length - 1]}`;
}

function supplierName(s: WizardState): string {
  return s.supplier.legalName.trim() || "The supplier";
}

function asOf(days: string): string | null {
  if (!/^\d+$/.test(days.trim())) return null;
  const d = new Date(Date.now() + Number(days.trim()) * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export function StepConsequences({ step, s, ctx }: { step: number; s: WizardState; ctx: WizardContext }) {
  const total = goodsTotal(s);
  const code = ctx.asset.code;
  const amounts = effectiveAmounts(s);
  const items: React.ReactNode[] = [];

  if (step === 0) {
    items.push(
      `${ctx.buyer.legalName} funds the escrow${ctx.buyer.address ? ` and signs as ${shortAddress(ctx.buyer.address)}` : ""}.`,
      s.supplier.contact === "address"
        ? `${supplierName(s)} is paid every milestone and signs as ${s.supplier.signingAddress.trim() ? shortAddress(s.supplier.signingAddress.trim()) : "the address you enter"}.`
        : `${supplierName(s)} is invited by email. Terms can't freeze until they register a signing address.`,
      s.inspector.appointed ? `${s.inspector.name.trim() || "The inspector"} approves only the milestones you name. Never paid.` : "No inspector. Only buyer or supplier can approve.",
      s.forwarder.appointed ? `${s.forwarder.name.trim() || "The forwarder"} attests shipment events and approves only the milestones you name.` : "No forwarder. Carrier events stay context and can't count toward a release.",
    );
  }

  if (step === 1) {
    items.push(`${s.lineItems.length} line${s.lineItems.length === 1 ? "" : "s"} totalling ${units(total, code)}. This is the exact escrow amount.`);
    if (s.incotermRule) {
      items.push(`${s.incotermRule} ${s.namedPlace.trim() || "(named place)"}, Incoterms® 2020: ${INCOTERM_RISK[s.incotermRule]}.`);
      if (SEA_ONLY.includes(s.incotermRule) && s.transportMode && s.transportMode !== "sea") items.push(`${s.incotermRule} is for sea and inland waterway. Consider FCA, CPT or CIP for ${s.transportMode}.`);
    } else items.push("Plimsoll records the Incoterms® rule. It does not interpret or enforce it.");
    items.push("Invoices and packing lists reconcile line by line against these SKUs, quantities and prices.");
  }

  if (step === 2) {
    items.push(`Escrow holds exactly ${units(total, code)} on ${ctx.asset.networkLabel}${ctx.asset.isDemo ? `, a demo token, not USDC` : ""}. The asset is fixed at deploy.`);
    items.push("The buyer funds the full amount before any milestone can release.");
    s.milestones.forEach((m, i) => {
      const u = safeUnits(amounts[i] ?? "");
      items.push(`M${i + 1} ${m.name.trim() || "Untitled"}: ${u === null ? "amount incomplete" : `${units(u, code)} (${total > 0n ? percentOf(u, total).toFixed(2) : "0.00"}%)`} to ${s.supplier.legalName.trim() || "the supplier"}.`);
    });
    items.push("Amounts must sum to the total to the last unit. No rounding at settlement.");
  }

  if (step === 3) {
    s.milestones.forEach((m, i) => {
      const u = safeUnits(amounts[i] ?? "");
      items.push(`M${i + 1} releases ${u === null ? "its amount" : units(u, code)} when ${m.quorum || "?"} of ${m.approverRoles.length} (${roleList(m.approverRoles) || "none chosen"}) sign the anchored evidence.`);
    });
    items.push("The contract checks every signature against these terms. No Plimsoll button releases funds alone.");
  }

  if (step === 4) {
    s.milestones.forEach((m, i) => {
      items.push(m.requiredDocuments.length === 0 ? `M${i + 1} needs no documents.` : `M${i + 1} bundles evidence once ${m.requiredDocuments.map((d) => DOCUMENT_TYPE_LABELS[d].toLowerCase()).join(", ")} ${m.requiredDocuments.length === 1 ? "is" : "are"} uploaded with no blocking mismatch.`);
    });
    items.push(s.quantityBps.trim() === "0" ? "Any quantity difference blocks." : `Quantity differences within ${bpsLabel(s.quantityBps)} warn, beyond it block.`);
    items.push(`Weight differences within ${bpsLabel(s.weightBps)} warn, beyond it block.`);
  }

  if (step === 5) {
    const deadline = asOf(s.fundingDeadlineDays);
    items.push(`Fund within ${s.fundingDeadlineDays || "?"} days of saving${deadline ? ` (about ${deadline})` : ""}. After that a partly funded escrow can be cancelled and deposits returned.`);
    s.milestones.forEach((m, i) => {
      const days = m.refundAfterDays.trim();
      items.push(days === "0" || days === "" ? `M${i + 1} has no refund window. Funds stay until release or a resolver decision.` : `M${i + 1}, if open and undisputed after ${days} days${asOf(days) ? ` (about ${asOf(days)})` : ""}, can be refunded to the buyer by anyone.`);
    });
    items.push(`A dispute freezes only the disputed milestone. ${s.resolver.name.trim() || "The resolver"} alone signs the split. Plimsoll has no override.`);
    items.push(`Law: ${s.governingLaw.trim() || "not stated"}. Forum: ${s.disputeForum.trim() || "not stated"}.`);
  }

  if (items.length === 0) return null;
  return (
    <ul className="consequences">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
