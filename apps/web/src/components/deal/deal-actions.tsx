"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DealView } from "@/lib/views";
import { api, errorMessage, newIdempotencyKey } from "@/lib/api";
import { units } from "@/lib/format";
import { ChainActionButton } from "../chain-action";
import { useToast } from "../toast";

/** Agreement-level actions: submit terms, accept, fund, cancel, amend. */
export function DealActions({ deal }: { deal: DealView }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const isBuyer = deal.myRoles.includes("buyer");
  const isSupplier = deal.myRoles.includes("supplier");
  const isParty = isBuyer || isSupplier;
  const chain = deal.chain;
  const code = deal.asset.code;

  const submitTerms = async () => {
    setBusy(true);
    try {
      const r = await api<{ contractId: string; termsDigest: string }>(`/deals/${deal.id}/terms/submit`, { body: { version: deal.version }, idempotencyKey: newIdempotencyKey() });
      toast(`Escrow deployed: ${r.contractId.slice(0, 10)}…; terms digest ${r.termsDigest.slice(0, 10)}…`);
      router.refresh();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const amend = async () => {
    setBusy(true);
    try {
      await api(`/deals/${deal.id}/amend`, { method: "POST" });
      router.push(`/deals/${deal.id}/edit`);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  if (deal.status === "draft") {
    if (!isBuyer) return <p className="why-not">Buyer is drafting terms.</p>;
    const missingSupplier = !deal.terms.supplier.address;
    return (
      <div className="stack tight">
        <button type="button" className="btn primary" disabled={busy || missingSupplier} onClick={submitTerms}>
          {busy ? "Deploying escrow…" : "Freeze terms and deploy"}
        </button>
        {missingSupplier ? <p className="why-not">Supplier has no signing address yet.</p> : <p className="tiny muted">One escrow contract per deal on {deal.network.label}. Terms lock on deploy.</p>}
        <Link className="btn" href={`/deals/${deal.id}/edit`}>
          Edit draft
        </Link>
      </div>
    );
  }

  if (!chain) return <p className="why-not">Waiting for the first ledger read.</p>;

  const mine = deal.myAddresses;
  const buyerPending = !chain.buyerAccepted;
  const supplierPending = !chain.supplierAccepted;
  const iCanAccept = (isBuyer && buyerPending && mine.includes(deal.terms.buyer.address)) || (isSupplier && supplierPending && mine.includes(deal.terms.supplier.address));
  const remaining = BigInt(chain.total) - BigInt(chain.funded);

  return (
    <div className="stack tight">
      {chain.status === "AwaitingAcceptance" ? (
        <ChainActionButton
          dealId={deal.id}
          input={{ action: "accept_terms" }}
          label="Sign terms"
          tone="primary"
          assetCode={code}
          disabledReason={iCanAccept ? null : !isParty ? "Only buyer and supplier sign." : `Waiting on ${buyerPending ? deal.terms.buyer.legalName : deal.terms.supplier.legalName}.`}
        />
      ) : null}
      {chain.status === "AwaitingFunding" ? (
        <ChainActionButton dealId={deal.id} input={{ action: "fund" }} label={`Fund ${units(remaining, code)}`} tone="primary" assetCode={code} disabledReason={isBuyer ? null : "Buyer funds escrow."} />
      ) : null}
      {(chain.status === "AwaitingAcceptance" || chain.status === "AwaitingFunding") && isParty ? (
        <ChainActionButton dealId={deal.id} input={{ action: "cancel_unfunded" }} label="Cancel agreement" tone="danger" size="sm" assetCode={code} disabledReason={null} />
      ) : null}
      {chain.status === "Cancelled" && isParty ? (
        <button type="button" className="btn" disabled={busy} onClick={amend}>
          Reopen as amendment
        </button>
      ) : null}
      {chain.status === "Funded" ? <p className="tiny muted">Fully funded. Money moves per milestone only.</p> : null}
      {chain.status === "Completed" ? <p className="tiny muted">All milestones settled. Balance is zero.</p> : null}
    </div>
  );
}
