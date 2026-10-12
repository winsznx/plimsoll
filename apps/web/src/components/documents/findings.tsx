"use client";

import { ArrowRight, Info, LockSimple, UploadSimple } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useRef, useState, type KeyboardEvent } from "react";
import type { DiscrepancyView, MilestoneView } from "@/lib/views";
import { api, ApiClientError, errorMessage } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { Figure } from "../instruments/figure";
import { useToast } from "../toast";
import { ACTIVE_STATES, sideLabel, type VersionRef } from "./model";
import { documentTypeLabel, FindingStateChip, SeverityChip } from "./status";
import styles from "./documents.module.css";

type Decision = "correction_requested" | "accepted_as_is" | "non_material";

const DECISIONS: { id: Decision; label: string; prompt: string; done: string }[] = [
  { id: "correction_requested", label: "Request correction", prompt: "What must the corrected document show?", done: "Correction requested" },
  { id: "accepted_as_is", label: "Accept as-is", prompt: "Why is it acceptable as it stands?", done: "Accepted as-is" },
  { id: "non_material", label: "Declare non-material", prompt: "Why doesn't the difference matter commercially?", done: "Declared non-material" },
];

const AMENDMENT_RULES = new Set(["R-INVOICE-TOTAL", "R-CURRENCY"]);
const REVIEWER_ROLES = ["buyer", "supplier", "inspector"];

export interface FindingsProps {
  dealId: string;
  findings: DiscrepancyView[];
  selectedId: string | null;
  onSelect: (finding: DiscrepancyView) => void;
  index: Map<string, VersionRef>;
  termsVersion: number;
  myRoles: string[];
  onRequestUpload: (finding: DiscrepancyView) => void;
}

const isOpen = (f: DiscrepancyView) => f.active && ACTIVE_STATES.has(f.state);

export function FindingsList({ findings, selectedId, onSelect, holdsOf }: Pick<FindingsProps, "findings" | "selectedId" | "onSelect"> & { holdsOf: (finding: DiscrepancyView) => MilestoneView[] }) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (e: KeyboardEvent<HTMLUListElement>) => {
    const current = findings.findIndex((f) => f.id === selectedId);
    const next = e.key === "ArrowDown" || e.key === "ArrowRight" ? current + 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? current - 1 : e.key === "Home" ? 0 : e.key === "End" ? findings.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const clamped = Math.max(0, Math.min(findings.length - 1, next));
    const target = findings[clamped];
    if (!target) return;
    onSelect(target);
    buttons.current[clamped]?.focus();
  };

  if (findings.length === 0) {
    return (
      <p className="empty">
        <strong>No findings</strong>
        Every rule passed on the latest versions.
      </p>
    );
  }

  return (
    <ul className={styles.findingList} aria-label="Findings. Use arrow keys to move between findings." onKeyDown={move}>
      {findings.map((f, i) => {
        const selected = f.id === selectedId;
        const open = isOpen(f);
        const holds = holdsOf(f);
        return (
          <li key={f.id}>
            <button
              ref={(el) => {
                buttons.current[i] = el;
              }}
              type="button"
              className={`${styles.finding} ${selected ? styles.findingSelected : ""} ${open && f.severity === "blocking" ? styles.findingBlocking : ""} ${f.active ? "" : styles.findingInactive}`}
              aria-pressed={selected}
              tabIndex={selected || (selectedId === null && i === 0) ? 0 : -1}
              onClick={() => onSelect(f)}
            >
              <span className={styles.findingChips}>
                <SeverityChip severity={f.severity} />
                <FindingStateChip finding={f} />
              </span>
              <span className={styles.findingWhat}>
                <span className={styles.findingRule}>
                  {f.ruleId} · {f.field}
                </span>
                <span className={styles.findingMessage}>{f.message}</span>
              </span>
              <span className={styles.diff}>
                <span className={styles.diffExp}>
                  <i>Exp</i>
                  {f.expected.value ?? "none"}
                </span>
                <span className={`${styles.diffGot} ${f.severity === "blocking" && open ? styles.diffBad : ""}`}>
                  <i>Found</i>
                  {f.actual.value ?? "none"}
                </span>
              </span>
              <span className={styles.holds}>
                {holds.length > 0 ? (
                  <>
                    <span className={styles.holdsTag}>
                      <LockSimple weight="fill" aria-hidden />
                      Holds {holds.map((m) => `M${m.ordinal + 1}`).join(", ")}
                    </span>
                    <Figure units={holds.reduce((a, m) => a + BigInt(m.amount), 0n)} size="sm" />
                  </>
                ) : (
                  <span className={styles.noHold}>No hold</span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function FindingDetail({ dealId, finding, index, termsVersion, myRoles, onRequestUpload }: Omit<FindingsProps, "findings" | "selectedId" | "onSelect"> & { finding: DiscrepancyView }) {
  const f = finding;
  const reviewable = isOpen(f);
  const isSupplier = myRoles.includes("supplier");
  return (
    <div className={styles.detail}>
      <div className={styles.detailCol}>
        <p className={styles.detailHead}>
          Selected · {f.ruleId} · {f.field}
        </p>
        <div className={styles.versus}>
          <div>
            <span className={styles.versusLabel}>Expected</span>
            <strong>{f.expected.value ?? "none"}</strong>
            <span className="tiny faint">{sideLabel(f.expected, index, termsVersion)}</span>
          </div>
          <ArrowRight aria-hidden className={styles.versusArrow} />
          <div className={f.severity === "blocking" && reviewable ? styles.versusBad : ""}>
            <span className={styles.versusLabel}>Found</span>
            <strong>{f.actual.value ?? "not found"}</strong>
            <span className="tiny faint">{sideLabel(f.actual, index, termsVersion)}</span>
          </div>
        </div>
        {f.actual.span ? (
          <p className={styles.quote}>
            p.{f.actual.span.page} “{f.actual.span.text}”
          </p>
        ) : null}
      </div>

      <div className={styles.detailCol}>
        <dl className={`kv ${styles.detailKv}`}>
          <dt>Severity</dt>
          <dd>
            <SeverityChip severity={f.severity} /> <span className="tiny faint">set by rule</span>
          </dd>
          <dt>Confidence</dt>
          <dd>
            <span className="mono small">{Math.round(f.confidence * 100)}%</span>
            {f.modelExtracted ? <span className="tiny faint"> · model-read, check the original</span> : null}
          </dd>
          <dt>State</dt>
          <dd>
            <FindingStateChip finding={f} />
          </dd>
          {f.resolvedBy || f.resolutionReason ? (
            <>
              <dt>{f.state === "resolved" ? "Last note" : "Decision"}</dt>
              <dd className="small">
                <strong>{f.resolvedBy ?? "Reconciliation engine"}</strong>
                {f.resolvedAt ? <span className="tiny faint"> · {fmtDateTime(f.resolvedAt)}</span> : null}
                {f.resolutionReason ? <span style={{ display: "block", marginTop: 2 }}>{f.resolutionReason}</span> : null}
              </dd>
            </>
          ) : null}
        </dl>

        {f.explanation ? (
          <div className={styles.explanation}>
            <p className={styles.explanationHead}>
              <Info aria-hidden />
              Model note · {f.explanationModel ?? "unknown"} · advisory
            </p>
            <p className="small">{f.explanation}</p>
          </div>
        ) : null}
      </div>

      <div className={styles.detailCol}>
        {f.state === "correction_requested" && f.active ? (
          isSupplier && f.actual.documentId ? (
            <div className={styles.correction}>
              <strong>
                {f.resolvedBy ?? "A reviewer"} asked for a corrected {documentTypeLabel(f.actual.documentType).toLowerCase()}
              </strong>
              <p className="tiny muted">Upload it as a new version. The current one stays on record.</p>
              <button type="button" className="btn primary sm" onClick={() => onRequestUpload(f)}>
                <UploadSimple aria-hidden />
                Upload corrected version
              </button>
            </div>
          ) : (
            <p className="small muted">Waiting for the supplier&apos;s corrected version.</p>
          )
        ) : null}

        {reviewable ? <ReviewActions key={f.id} dealId={dealId} finding={f} myRoles={myRoles} /> : null}
        {!f.active ? <p className="tiny faint">No longer reproduces on current versions. Kept on record.</p> : null}
      </div>
    </div>
  );
}

function ReviewActions({ dealId, finding, myRoles }: { dealId: string; finding: DiscrepancyView; myRoles: string[] }) {
  const router = useRouter();
  const toast = useToast();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);

  const canReview = myRoles.some((r) => REVIEWER_ROLES.includes(r));
  const isBuyer = myRoles.includes("buyer");
  const whyNot = (d: Decision): string | null => {
    if (!canReview) return "Buyer, supplier or inspector only.";
    if (d === "correction_requested") return finding.state === "correction_requested" ? "Already requested. The supplier uploads a new version." : null;
    if (AMENDMENT_RULES.has(finding.ruleId)) return "Price or currency needs a bilateral amendment, not a waiver.";
    if (finding.severity === "blocking" && !isBuyer) return "Only the buyer can waive a blocking finding.";
    return null;
  };
  const chosen = DECISIONS.find((d) => d.id === decision) ?? null;
  const reasons = [...new Set(DECISIONS.map((d) => whyNot(d.id)).filter((r): r is string => r !== null))];

  const submit = async () => {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/deals/${dealId}/discrepancies/${finding.id}/review`, {
        body: { decision: chosen.id, reason: reason.trim() },
      });
      toast(`${chosen.done}: ${finding.ruleId} on ${finding.field}`);
      setDecision(null);
      setReason("");
      router.refresh();
    } catch (e) {
      const code = e instanceof ApiClientError ? e.code : null;
      setError({ title: code === "ROLE_DENIED" ? "Not permitted for your role" : code === "TERMS_VERSION_STALE" ? "Needs a terms amendment" : "Decision not recorded", message: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.decide}>
      <div className={styles.decideRow}>
        <span className={styles.decideLabel}>Correct</span>
        <div className="btn-group">
          {DECISIONS.slice(0, 1).map((d) => (
            <button key={d.id} type="button" className="btn sm" aria-pressed={decision === d.id} disabled={Boolean(whyNot(d.id)) || busy} title={whyNot(d.id) ?? undefined} onClick={() => setDecision(d.id)}>
              {d.label}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.decideRow}>
        <span className={styles.decideLabel}>Waive</span>
        <div className="btn-group">
          {DECISIONS.slice(1).map((d) => (
            <button key={d.id} type="button" className="btn sm ghost" aria-pressed={decision === d.id} disabled={Boolean(whyNot(d.id)) || busy} title={whyNot(d.id) ?? undefined} onClick={() => setDecision(d.id)}>
              {d.label}
            </button>
          ))}
        </div>
      </div>
      {reasons.map((r) => (
        <p key={r} className="why-not" style={{ marginTop: 0 }}>
          {r}
        </p>
      ))}
      {chosen ? (
        <div className={styles.decisionForm}>
          <label className="field">
            <span className="label">{chosen.prompt}</span>
            <textarea className="input" value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} maxLength={2000} />
            <span className="hint">Recorded with your name, role and the document version.</span>
          </label>
          <div className="row" style={{ marginTop: 10 }}>
            <button type="button" className="btn sm primary" disabled={busy || reason.trim().length < 5} aria-describedby={reason.trim().length < 5 ? "reason-why-not" : undefined} onClick={submit}>
              {busy ? "Recording…" : `Record: ${chosen.label.toLowerCase()}`}
            </button>
            <button type="button" className="btn sm" onClick={() => setDecision(null)} disabled={busy}>
              Cancel
            </button>
          </div>
          {reason.trim().length < 5 ? (
            <p className="why-not" id="reason-why-not">
              At least 5 characters.
            </p>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <div className="callout alert" role="alert">
          <span className="mark">!</span>
          <div>
            <strong>{error.title}</strong>
            <p>{error.message}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
