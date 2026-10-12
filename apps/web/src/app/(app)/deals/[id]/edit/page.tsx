import { ArrowLeft, ArrowRight, LockSimple } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DealStatusChip } from "@/components/chip";
import { DealWizard } from "@/components/wizard/deal-wizard";
import { fromTerms } from "@/components/wizard/model";
import { requireSession } from "@/server/auth/guard";
import { ApiError } from "@/server/http";
import { dealAccess, type DealAccess } from "@/server/services/access";
import { wizardContext } from "@/server/services/wizard-context";

export const metadata: Metadata = { title: "Edit draft" };

function whyNot(access: DealAccess): string | null {
  if (!access.roles.includes("buyer")) return "Only the buyer edits draft terms.";
  if (access.deal.status === "awaiting_acceptance" || access.deal.status === "awaiting_funding") return "Terms are fixed in the deployed escrow. Cancel the unfunded escrow on-chain, then reopen terms as an amendment from the deal page.";
  if (access.deal.status !== "draft") return "Terms are fixed in a funded or closed escrow and can't be edited.";
  return null;
}

export default async function EditDraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  let access: DealAccess;
  try {
    access = await dealAccess(session, id);
  } catch (e) {
    if (e instanceof ApiError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const { deal, participants } = access;
  const blocked = whyNot(access);

  const head = (
    <div className="page-head">
      <div>
        <p className="eyebrow">
          {deal.reference} · {deal.terms.poNumber} · v{deal.version}
        </p>
        <h1 style={{ marginTop: 6 }}>Edit draft: {deal.title}</h1>
        <div className="sub">
          <DealStatusChip status={deal.status} />
          <span>
            {deal.terms.buyer.legalName} <ArrowRight aria-label="to" style={{ verticalAlign: -2 }} /> {deal.terms.supplier.legalName}
          </span>
        </div>
      </div>
      <div className="btn-group">
        <Link className="btn" href={`/deals/${deal.id}`}>
          <ArrowLeft aria-hidden />
          Back to deal
        </Link>
      </div>
    </div>
  );

  if (blocked) {
    return (
      <>
        {head}
        <section className="panel" style={{ maxWidth: 640 }}>
          <div className="panel-body stack tight">
            <div className="row wrap">
              <button type="button" className="btn primary" disabled>
                <LockSimple aria-hidden />
                Edit draft terms
              </button>
              <Link className="ext small" href={`/deals/${deal.id}`}>
                Open {deal.reference}
              </Link>
            </div>
            <p className="why-not">{blocked}</p>
          </div>
        </section>
      </>
    );
  }

  const supplierRow = participants.find((p) => p.role === "supplier");
  const ctx = await wizardContext(session, deal.terms.supplier.orgId ? { orgId: deal.terms.supplier.orgId, name: deal.terms.supplier.legalName, addresses: deal.terms.supplier.address ? [deal.terms.supplier.address] : [], dealRefs: [deal.reference] } : undefined);
  const initial = fromTerms(deal.terms, {
    title: deal.title,
    savedAt: deal.updatedAt,
    supplierInviteEmail: supplierRow?.inviteEmail ?? null,
    participants: participants.map((p) => ({ role: p.role, name: p.displayName, address: p.signingAddress })),
  });

  return (
    <>
      {deal.isSample ? <p className="sample-banner">Sample deal · synthetic organizations and documents</p> : null}
      {head}
      <DealWizard ctx={ctx} initial={initial} mode={{ kind: "edit", dealId: deal.id, reference: deal.reference, version: deal.version }} />
    </>
  );
}
