"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api, ApiClientError, errorMessage, newIdempotencyKey } from "@/lib/api";
import { connectFreighter, signWithFreighter } from "@/lib/freighter";
import { units } from "@/lib/format";
import { useToast } from "./toast";

export type ActionInput =
  | { action: "accept_terms" | "fund" | "cancel_unfunded" }
  | { action: "anchor_evidence" | "approve_milestone" | "revoke_approval"; milestoneOrdinal: number }
  | { action: "open_dispute"; milestoneOrdinal: number; reason: string }
  | { action: "resolve_dispute"; milestoneOrdinal: number; toBuyer: string; toPayee: string; rationale: string };

interface Review {
  title: string;
  consequences: string[];
  network: string;
  contractId: string;
  method: string;
  signer: string;
  signerName: string;
  amountUnits: string | null;
}

interface Prepared {
  intentId: string;
  signing: "demo_custodial" | "wallet";
  xdr: string | null;
  networkPassphrase: string;
  review: Review;
}

type Phase = { kind: "idle" } | { kind: "preparing" } | { kind: "review"; prepared: Prepared } | { kind: "signing"; prepared: Prepared; step: string } | { kind: "error"; message: string; prepared: Prepared | null };

interface Props {
  dealId: string;
  input: ActionInput | (() => ActionInput | null);
  label: string;
  tone?: "primary" | "default" | "danger";
  size?: "sm" | "md";
  disabledReason?: string | null;
  /** False when the caller shows the reason once for a group of buttons; it still disables and titles the button. */
  showReason?: boolean;
  assetCode: string;
  onDone?: () => void;
}

/**
 * Every signed action goes prepare → explicit review of on-chain consequences → sign → submit.
 * Nothing is shown as settled until the server has the ledger result.
 */
export function ChainActionButton({ dealId, input, label, tone = "default", size = "md", disabledReason, showReason = true, assetCode, onDone }: Props) {
  const router = useRouter();
  const toast = useToast();
  const dialog = useRef<HTMLDialogElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [idemKey, setIdemKey] = useState<string>("");

  const open = async () => {
    const resolved = typeof input === "function" ? input() : input;
    if (!resolved) return;
    setPhase({ kind: "preparing" });
    dialog.current?.showModal();
    try {
      const prepared = await api<Prepared>(`/deals/${dealId}/actions/prepare`, { body: resolved });
      setIdemKey(newIdempotencyKey());
      setPhase({ kind: "review", prepared });
    } catch (e) {
      setPhase({ kind: "error", message: errorMessage(e), prepared: null });
    }
  };

  const close = () => {
    dialog.current?.close();
    setPhase({ kind: "idle" });
  };

  const confirm = async (prepared: Prepared) => {
    try {
      let signedXdr: string | null = null;
      if (prepared.signing === "wallet") {
        setPhase({ kind: "signing", prepared, step: "Waiting for Freighter signature…" });
        const address = await connectFreighter(prepared.networkPassphrase);
        if (address !== prepared.review.signer) throw new Error(`Freighter is using ${address.slice(0, 6)}…, but this action must be signed by ${prepared.review.signer.slice(0, 6)}….`);
        signedXdr = await signWithFreighter(prepared.xdr!, prepared.networkPassphrase, address);
      }
      setPhase({ kind: "signing", prepared, step: "Submitted. Waiting for ledger confirmation…" });
      const res = await api<{ txHash: string; status: "confirmed" | "pending"; ledger: number | null }>(`/deals/${dealId}/actions/submit`, { body: { intentId: prepared.intentId, signedXdr }, idempotencyKey: idemKey });
      toast(res.status === "confirmed" ? `Confirmed on ledger ${res.ledger}: ${res.txHash.slice(0, 10)}…` : `Submitted ${res.txHash.slice(0, 10)}…; awaiting confirmation. Status will reconcile from the ledger.`);
      close();
      onDone?.();
      router.refresh();
    } catch (e) {
      setPhase({ kind: "error", message: errorMessage(e), prepared });
      if (e instanceof ApiClientError && e.code === "SIGNATURE_EXPIRED") setIdemKey(newIdempotencyKey());
    }
  };

  const disabled = Boolean(disabledReason) || phase.kind === "preparing";
  const prepared = phase.kind === "review" || phase.kind === "signing" ? phase.prepared : phase.kind === "error" ? phase.prepared : null;

  return (
    <div>
      <button type="button" className={`btn ${size === "sm" ? "sm" : ""} ${tone === "primary" ? "primary" : tone === "danger" ? "danger" : ""}`} aria-disabled={disabled} disabled={disabled} title={showReason ? undefined : (disabledReason ?? undefined)} onClick={open}>
        {label}
      </button>
      {disabledReason && showReason ? <p className="why-not">{disabledReason}</p> : null}

      <dialog ref={dialog} className="sheet" aria-labelledby={`dlg-${label}`} onClose={() => setPhase({ kind: "idle" })}>
        <div className="sheet-head">
          <p className="eyebrow">Review before signing</p>
          <h2 id={`dlg-${label}`} style={{ marginTop: 6 }}>
            {prepared?.review.title ?? label}
          </h2>
        </div>
        <div className="sheet-body">
          {phase.kind === "preparing" ? <p className="muted small" aria-live="polite">Reading current on-chain state and simulating the call…</p> : null}
          {prepared ? (
            <>
              <ul className="consequences">
                {prepared.review.consequences.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              <dl className="kv">
                <dt>Signer</dt>
                <dd>
                  {prepared.review.signerName} <span className="mono faint">{prepared.review.signer.slice(0, 6)}…{prepared.review.signer.slice(-4)}</span>
                </dd>
                <dt>Signing</dt>
                <dd>{prepared.signing === "demo_custodial" ? "Demo custody key held by this testnet deployment" : "Your Freighter wallet"}</dd>
                <dt>Contract</dt>
                <dd className="mono">{prepared.review.contractId.slice(0, 10)}…{prepared.review.contractId.slice(-6)}</dd>
                <dt>Method</dt>
                <dd className="mono">{prepared.review.method}</dd>
                <dt>Network</dt>
                <dd>{prepared.review.network}</dd>
                {prepared.review.amountUnits ? (
                  <>
                    <dt>Amount</dt>
                    <dd className="mono">{units(prepared.review.amountUnits, assetCode)}</dd>
                  </>
                ) : null}
                <dt>Fees</dt>
                <dd>Network fees are sponsored by the Plimsoll relayer; it cannot move escrow funds.</dd>
              </dl>
            </>
          ) : null}
          {phase.kind === "signing" ? (
            <p className="small" aria-live="polite">
              {phase.step}
            </p>
          ) : null}
          {phase.kind === "error" ? (
            <div className="callout alert" role="alert">
              <span className="mark">!</span>
              <div>
                <strong>Not submitted</strong>
                <p>{phase.message}</p>
              </div>
            </div>
          ) : null}
        </div>
        <div className="sheet-foot">
          <button type="button" className="btn" onClick={close}>
            {phase.kind === "error" ? "Close" : "Cancel"}
          </button>
          {phase.kind === "review" ? (
            <button type="button" className="btn primary" onClick={() => confirm(phase.prepared)}>
              {phase.prepared.signing === "wallet" ? "Sign in Freighter" : "Sign and submit"}
            </button>
          ) : null}
        </div>
      </dialog>
    </div>
  );
}

/** Release and timed refunds are permissionless; the contract alone decides eligibility. */
export function PermissionlessButton({ dealId, ordinal, kind, label, tone = "primary", explanation, showReason = true, assetCode, amount }: { dealId: string; ordinal: number; kind: "release" | "refund"; label: string; tone?: "primary" | "default"; explanation: string | null; showReason?: boolean; assetCode: string; amount: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [rejection, setRejection] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setRejection(null);
    try {
      const res = await api<{ txHash: string; ledger: number | null; status: string }>(`/deals/${dealId}/milestones/${ordinal}/${kind}`, { method: "POST", idempotencyKey: newIdempotencyKey() });
      toast(`${kind === "release" ? "Released" : "Refunded"} ${units(amount, assetCode)} · ledger ${res.ledger ?? "pending"}`);
      router.refresh();
    } catch (e) {
      const msg = errorMessage(e);
      setRejection(msg);
      toast(msg, "error");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <button type="button" className={`btn ${tone === "primary" ? "primary" : ""}`} disabled={busy} title={showReason ? undefined : (explanation ?? undefined)} onClick={run}>
        {busy ? "Waiting for ledger…" : label}
      </button>
      {explanation && showReason ? <p className="why-not">{explanation}</p> : null}
      {rejection ? (
        <p className="small" role="alert" style={{ color: "var(--alert)", marginTop: 6 }}>
          {rejection}
        </p>
      ) : null}
    </div>
  );
}
