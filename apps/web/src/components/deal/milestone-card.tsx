"use client";

import { CheckCircle, Circle, FileText, LockSimple, ShieldCheck, Signature, Warning } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { DOCUMENT_TYPE_LABELS, type DocumentType } from "@plimsoll/domain";
import type { DealView, MilestoneView } from "@/lib/views";
import { api, errorMessage } from "@/lib/api";
import { fmtDate, units } from "@/lib/format";
import { ChainActionButton, PermissionlessButton } from "../chain-action";
import { MilestonePhaseChip, Chip } from "../chip";
import { Hash } from "../hash";
import { Figure } from "../instruments/figure";
import { useToast } from "../toast";
import styles from "./milestone-card.module.css";

/** shut holds money (red); todo is simply not done yet. */
type LockState = "open" | "todo" | "shut" | "na";

function Lock({ state, icon, title, children }: { state: LockState; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className={`${styles.lock} ${styles[state]}`}>
      <span className={styles.lockIcon} aria-hidden>
        {icon}
      </span>
      <span className={styles.lockTitle}>{title}</span>
      <span className={styles.lockBody}>{children}</span>
      <span className={styles.lockState}>{state === "open" ? <CheckCircle weight="fill" aria-label="Met" /> : state === "na" ? <Circle aria-label="Not required" /> : <LockSimple weight="fill" aria-label={state === "shut" ? "Blocking" : "Not met"} />}</span>
    </li>
  );
}

export function MilestoneCard({ deal, m }: { deal: DealView; m: MilestoneView }) {
  const router = useRouter();
  const toast = useToast();
  const [preparing, setPreparing] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [reason, setReason] = useState("");
  const code = deal.asset.code;
  const gate = m.gate;
  const allowed = new Set(gate?.allowed ?? []);
  const why = gate?.blockedReasons ?? {};
  const funded = deal.chain?.status === "Funded";
  const settled = m.chainStatus === "Released" || m.chainStatus === "Resolved" || m.chainStatus === "Refunded";
  const isParticipant = deal.myRoles.some((r) => r !== "resolver");
  const canPrepare = !settled && m.chainStatus !== "Disputed" && m.missingDocuments.length === 0 && m.openBlockingFindings === 0 && isParticipant && Boolean(deal.termsDigest);
  const stale = m.preparedDigest !== null && m.evidenceDigest !== null && m.preparedDigest !== m.evidenceDigest;
  const approved = m.approvers.filter((a) => a.approved).length;
  const held = gate?.phase === "blocked" || m.openBlockingFindings > 0;
  const lockReason = gate && !allowed.has("release") && gate.phase !== "disputed" ? (why.release ?? why.approve ?? null) : null;

  const prepare = async () => {
    setPreparing(true);
    try {
      const r = await api<{ digest: string; reused: boolean }>(`/deals/${deal.id}/milestones/${m.ordinal}/evidence-bundle`, { method: "POST" });
      toast(r.reused ? "Evidence unchanged. Bundle still current." : `Bundle ${r.digest.slice(0, 10)}… prepared`);
      router.refresh();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setPreparing(false);
    }
  };

  return (
    <article className={`${styles.card} ${settled ? styles.settled : ""} ${held && !settled ? styles.held : ""}`} aria-labelledby={`m-${m.ordinal}`}>
      <header className={styles.head}>
        <span className={styles.index}>{m.ordinal + 1}</span>
        <div className="grow">
          <h3 id={`m-${m.ordinal}`}>{m.name}</h3>
          <p className={styles.condition}>{m.condition}</p>
        </div>
        <div className={styles.headRight}>
          <Figure units={m.amount} size="md" />
          {gate ? <MilestonePhaseChip phase={gate.phase} /> : <Chip tone="neutral">Not live</Chip>}
        </div>
      </header>

      {settled ? (
        <div className={styles.settledRow}>
          <span>
            Paid to <strong>{m.payeeName}</strong>
          </span>
          {m.settlementTx?.txHash ? <Hash value={m.settlementTx.txHash} href={m.settlementTx.explorerUrl} label="settlement transaction" /> : null}
          {m.settlementTx?.ledger ? <span className="mono faint tiny">ledger {m.settlementTx.ledger}</span> : null}
        </div>
      ) : (
        <ul className={styles.locks}>
          <Lock state={m.requiredDocuments.length === 0 ? "na" : m.missingDocuments.length === 0 ? "open" : "shut"} icon={<FileText />} title="Documents">
            {m.requiredDocuments.length === 0 ? "None required" : m.missingDocuments.length === 0 ? `${m.requiredDocuments.length} received` : `Missing ${m.missingDocuments.join(", ")}`}
          </Lock>
          <Lock state={m.requiredDocuments.length === 0 ? "na" : m.openBlockingFindings === 0 ? "open" : "shut"} icon={<Warning />} title="Findings">
            {m.openBlockingFindings === 0 ? (
              "No blocking mismatch"
            ) : (
              <Link className="ext" href={`/deals/${deal.id}/documents`}>
                {m.openBlockingFindings} blocking mismatch{m.openBlockingFindings === 1 ? "" : "es"}
              </Link>
            )}
          </Lock>
          <Lock state={stale ? "shut" : m.evidenceDigest ? "open" : "todo"} icon={<ShieldCheck />} title="Evidence">
            {m.evidenceDigest ? <Hash value={m.evidenceDigest} label="anchored evidence digest" /> : m.preparedDigest ? "Prepared, not anchored" : "Not anchored"}
            {stale ? <span className={styles.stale}>Changed since anchoring</span> : null}
          </Lock>
          <Lock state={approved >= m.quorum ? "open" : "todo"} icon={<Signature />} title={`Approvals ${approved}/${m.quorum}`}>
            <span className={styles.approvers}>
              {m.approvers.map((a) => (
                <span key={a.address} className={a.approved ? styles.signed : styles.unsigned} title={`${a.name} (${a.role})${a.approved ? " signed" : " pending"}`}>
                  {a.approved ? <CheckCircle weight="fill" aria-hidden /> : <Circle aria-hidden />}
                  {a.role}
                </span>
              ))}
            </span>
          </Lock>
        </ul>
      )}

      {!settled && gate ? (
        <footer className={styles.actions}>
          {funded && gate.phase !== "disputed" ? (
            <PermissionlessButton dealId={deal.id} ordinal={m.ordinal} kind="release" label={allowed.has("release") ? `Release ${units(m.amount, code)}` : "Attempt release"} tone={allowed.has("release") ? "primary" : "default"} explanation={allowed.has("release") ? null : (why.release ?? null)} showReason={false} assetCode={code} amount={m.amount} />
          ) : null}
          {gate.phase !== "disputed" ? <ChainActionButton dealId={deal.id} input={{ action: "approve_milestone", milestoneOrdinal: m.ordinal }} label="Approve" tone={allowed.has("approve") ? "primary" : "default"} assetCode={code} disabledReason={allowed.has("approve") ? null : (why.approve ?? null)} showReason={false} /> : null}
          {canPrepare && (!m.preparedDigest || stale || !m.evidenceDigest) ? (
            <button type="button" className="btn" onClick={prepare} disabled={preparing}>
              {preparing ? "Hashing…" : m.preparedDigest ? "Re-bundle evidence" : "Bundle evidence"}
            </button>
          ) : null}
          {allowed.has("anchor_evidence") ? <ChainActionButton dealId={deal.id} input={{ action: "anchor_evidence", milestoneOrdinal: m.ordinal }} label="Anchor evidence" assetCode={code} /> : null}
          {allowed.has("revoke_approval") ? <ChainActionButton dealId={deal.id} input={{ action: "revoke_approval", milestoneOrdinal: m.ordinal }} label="Revoke approval" tone="default" size="sm" assetCode={code} /> : null}
          {allowed.has("refund_expired") ? <PermissionlessButton dealId={deal.id} ordinal={m.ordinal} kind="refund" label="Refund buyer" tone="default" explanation="Refund deadline passed." assetCode={code} amount={m.amount} /> : null}
          {allowed.has("open_dispute") && !disputeOpen ? (
            <button type="button" className="btn ghost" onClick={() => setDisputeOpen(true)}>
              Dispute
            </button>
          ) : null}
          {gate.phase === "disputed" ? (
            <Link className="btn" href={`/deals/${deal.id}/disputes/${m.ordinal}`}>
              {allowed.has("resolve_dispute") ? "Resolve dispute" : "View dispute"}
            </Link>
          ) : null}
          <span className={styles.meta}>
            To {m.payeeName}
            {m.refundAfter > 0 ? ` · refund opens ${fmtDate(m.refundAfter * 1000)}` : ""}
          </span>
        </footer>
      ) : null}
      {lockReason ? <p className={`why-not ${styles.lockReason}`}>{lockReason}</p> : null}
      {!gate && deal.status !== "draft" ? <p className="why-not" style={{ padding: "0 18px 16px" }}>Waiting for the first ledger read.</p> : null}

      {disputeOpen ? (
        <div className={styles.dispute}>
          <label className="field">
            <span className="label">Reason (private; only its hash goes on-chain)</span>
            <textarea className="input" value={reason} onChange={(e) => setReason(e.target.value)} minLength={10} maxLength={2000} />
          </label>
          <div className="row">
            <ChainActionButton dealId={deal.id} input={() => (reason.trim().length >= 10 ? { action: "open_dispute", milestoneOrdinal: m.ordinal, reason: reason.trim() } : null)} label="Freeze this tranche" size="sm" tone="danger" assetCode={code} disabledReason={reason.trim().length >= 10 ? null : "At least 10 characters."} onDone={() => setDisputeOpen(false)} />
            <button type="button" className="btn sm ghost" onClick={() => setDisputeOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {m.requiredDocuments.length > 0 && !settled ? (
        <p className={styles.docs}>
          Needs {m.requiredDocuments.map((t) => DOCUMENT_TYPE_LABELS[t as DocumentType] ?? t).join(", ")}
        </p>
      ) : null}
    </article>
  );
}
