"use client";

import { ArrowCounterClockwise, CheckCircle, Circle, CircleDashed, LockSimple, WarningCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiClientError, api, errorMessage, newIdempotencyKey } from "@/lib/api";
import { REVIEW_STEP, STEPS, isWizardState, toDraftInput, validate, type WizardContext, type WizardState } from "./model";
import { WizardPreview } from "./preview";
import { ReviewStep } from "./review";
import { DeadlinesStep, DocumentsStep, EconomicsStep, GoodsStep, PartiesStep, ReleasesStep, type StepProps } from "./steps";
import styles from "./wizard.module.css";

export type WizardMode = { kind: "create" } | { kind: "edit"; dealId: string; reference: string; version: number };

interface SavedDraft {
  v: 1;
  state: WizardState;
  step: number;
  savedAt: string;
}

interface SubmitFailure {
  code: string;
  message: string;
  issues: string[];
}

const STEP_COMPONENTS: ((p: StepProps) => React.ReactNode)[] = [PartiesStep, GoodsStep, EconomicsStep, ReleasesStep, DocumentsStep, DeadlinesStep];

function storageKey(mode: WizardMode): string {
  return mode.kind === "create" ? "plimsoll.deal-wizard.new" : `plimsoll.deal-wizard.${mode.dealId}.v${mode.version}`;
}

function readSaved(key: string): SavedDraft | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedDraft>;
    if (parsed.v !== 1 || !isWizardState(parsed.state) || typeof parsed.step !== "number" || typeof parsed.savedAt !== "string") return null;
    return { v: 1, state: parsed.state, step: Math.min(Math.max(0, parsed.step), REVIEW_STEP), savedAt: parsed.savedAt };
  } catch {
    return null;
  }
}

function zodIssues(details: unknown): string[] {
  if (!Array.isArray(details)) return [];
  return details.flatMap((d) => {
    if (!d || typeof d !== "object") return [];
    const issue = d as { path?: unknown; message?: unknown };
    const path = Array.isArray(issue.path) ? issue.path.join(".") : typeof issue.path === "string" ? issue.path : "";
    return typeof issue.message === "string" ? [path ? `${path}: ${issue.message}` : issue.message] : [];
  });
}

/** The invitation token is returned only on creation, so this is the one chance to share the link. */
function InviteCreated({ id, reference, inviteUrl }: { id: string; reference: string; inviteUrl: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };
  return (
    <section className={`panel ${styles.created}`}>
      <div className={styles.createdHead} role="status">
        <CheckCircle weight="fill" aria-hidden />
        <div>
          <strong>Draft {reference} saved. Supplier invited.</strong>
          <p className="small muted">Send them this link to preview, sign in, pick a wallet and accept. Freeze terms once they have.</p>
        </div>
      </div>
      <div className="panel-body stack tight">
        <div className="field">
          <label htmlFor="invite-url">Invitation link</label>
          <div className="row" style={{ gap: 8 }}>
            <input id="invite-url" className="input mono grow" readOnly value={inviteUrl} onFocus={(e) => e.currentTarget.select()} aria-describedby="invite-url-hint" />
            <button type="button" className="btn" onClick={copy}>
              {copyState === "copied" ? "Copied" : "Copy link"}
            </button>
          </div>
          <span id="invite-url-hint" className="hint">
            Shown once. Expires in 14 days. Only the invited email can accept.
          </span>
          <span className="err" aria-live="polite">
            {copyState === "failed" ? "Copy failed. Select the link and copy it." : ""}
          </span>
        </div>
      </div>
      <div className={styles.foot}>
        <span />
        <Link className="btn primary" href={`/deals/${id}`}>
          Continue to deal
        </Link>
      </div>
    </section>
  );
}

export function DealWizard({ ctx, initial, mode }: { ctx: WizardContext; initial: WizardState; mode: WizardMode }) {
  const router = useRouter();
  const key = storageKey(mode);
  const [s, setS] = useState<WizardState>(initial);
  const [step, setStep] = useState(0);
  const [attempted, setAttempted] = useState<number[]>([]);
  const [restoredAt, setRestoredAt] = useState<string | null>(null);
  const [autosaveFailed, setAutosaveFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<SubmitFailure | null>(null);
  const [created, setCreated] = useState<{ id: string; reference: string; inviteUrl: string } | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Restoring an autosave reads browser storage, which is unavailable during the server render.
  useEffect(() => {
    const saved = readSaved(key);
    if (!saved) return;
    setS(saved.state);
    setStep(saved.step);
    setRestoredAt(saved.savedAt);
  }, [key]);

  const errors = useMemo(() => validate(s, ctx), [s, ctx]);
  const firstInvalid = errors.findIndex((e, i) => i < REVIEW_STEP && Object.keys(e).length > 0);
  const canVisit = (i: number) => firstInvalid === -1 || i <= firstInvalid;
  const shownErrors = attempted.includes(step) ? (errors[step] ?? {}) : {};
  const shownMessages = Object.values(shownErrors);

  const persist = (state: WizardState, nextStep: number) => {
    try {
      const saved: SavedDraft = { v: 1, state, step: nextStep, savedAt: new Date().toISOString() };
      window.localStorage.setItem(key, JSON.stringify(saved));
    } catch {
      setAutosaveFailed(true);
    }
  };

  const clearSaved = () => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      setAutosaveFailed(true);
    }
  };

  const update = (fn: (prev: WizardState) => WizardState) => {
    const next = fn(s);
    setS(next);
    setFailure(null);
    persist(next, step);
  };

  const goTo = (i: number) => {
    if (!canVisit(i)) return;
    setStep(i);
    persist(s, i);
    headingRef.current?.focus();
    window.scrollTo({ top: 0 });
  };

  const next = () => {
    if (Object.keys(errors[step] ?? {}).length > 0) {
      setAttempted((a) => (a.includes(step) ? a : [...a, step]));
      summaryRef.current?.focus();
      return;
    }
    goTo(step + 1);
  };

  const discardRestored = () => {
    clearSaved();
    setS(initial);
    setStep(0);
    setAttempted([]);
    setRestoredAt(null);
  };

  const submit = async () => {
    if (firstInvalid !== -1) {
      setAttempted(STEPS.map((_, i) => i));
      goTo(firstInvalid);
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const draft = toDraftInput(s);
      if (mode.kind === "create") {
        const r = await api<{ id: string; reference: string; inviteToken: string | null }>("/deals", { body: draft, idempotencyKey: newIdempotencyKey() });
        clearSaved();
        if (r.inviteToken) setCreated({ id: r.id, reference: r.reference, inviteUrl: `${window.location.origin}/invite/${r.inviteToken}` });
        else router.push(`/deals/${r.id}`);
      } else {
        await api<{ version: number }>(`/deals/${mode.dealId}`, { method: "PATCH", body: { version: mode.version, draft } });
        clearSaved();
        router.push(`/deals/${mode.dealId}`);
        router.refresh();
      }
    } catch (e) {
      if (e instanceof ApiClientError) setFailure({ code: e.code, message: e.message, issues: e.code === "VALIDATION_FAILED" ? zodIssues(e.details) : [] });
      else setFailure({ code: "INTERNAL", message: errorMessage(e), issues: [] });
    } finally {
      setBusy(false);
    }
  };

  if (created) return <InviteCreated {...created} />;

  const StepBody = STEP_COMPONENTS[step];
  const stepStatus = (i: number) => {
    const hasErrors = i < REVIEW_STEP && Object.keys(errors[i] ?? {}).length > 0;
    if (i === step) return "Current";
    if (!canVisit(i)) return "Locked";
    if (hasErrors && attempted.includes(i)) return "Needs attention";
    if (i < REVIEW_STEP && !hasErrors) return "Complete";
    return "Open";
  };

  return (
    <div className={styles.layout}>
      <nav className={styles.stepper} aria-label="Deal creation steps">
        <ol className={styles.steps}>
          {STEPS.map((label, i) => {
            const status = stepStatus(i);
            return (
              <li key={label}>
                <button type="button" className={`${styles.stepBtn} ${status === "Complete" ? styles.done : ""} ${status === "Needs attention" ? styles.bad : ""}`} aria-current={i === step ? "step" : undefined} disabled={!canVisit(i)} onClick={() => goTo(i)}>
                  <span className={styles.glyph} aria-hidden="true">
                    {status === "Complete" ? <CheckCircle weight="fill" /> : status === "Needs attention" ? <WarningCircle weight="fill" /> : status === "Current" ? <CircleDashed weight="bold" /> : status === "Locked" ? <LockSimple /> : <Circle />}
                  </span>
                  <span>
                    <strong>{label}</strong>
                    <small>{status}</small>
                  </span>
                  <span className={styles.ord} aria-hidden="true">
                    {i + 1}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <div className={`field ${styles.mobileStep}`}>
          <label htmlFor="wizard-step">
            Step {step + 1} of {STEPS.length}
          </label>
          <select id="wizard-step" className="input" value={step} onChange={(e) => goTo(Number(e.target.value))}>
            {STEPS.map((label, i) => (
              <option key={label} value={i} disabled={!canVisit(i)}>
                {i + 1}. {label}
              </option>
            ))}
          </select>
        </div>
      </nav>

      <section className={`panel ${styles.form}`} aria-labelledby="wizard-step-title">
        <div className={styles.formHead}>
          <div>
            <p className="eyebrow">
              Step {step + 1} of {STEPS.length}
            </p>
            <h2 id="wizard-step-title" ref={headingRef} tabIndex={-1} className={styles.stepTitle}>
              {STEPS[step]}
            </h2>
          </div>
          <span className={styles.autosave} aria-live="polite">
            {autosaveFailed ? "Autosave off in this browser" : "Autosaved on this device"}
          </span>
        </div>

        {restoredAt ? (
          <div className={styles.strip} role="status">
            <ArrowCounterClockwise aria-hidden />
            <span className="grow">
              Restored unsaved {mode.kind === "create" ? "deal" : "changes"} from {new Date(restoredAt).toLocaleString()}. This browser only.
            </span>
            <button type="button" className="btn ghost sm" onClick={discardRestored}>
              Discard and start over
            </button>
          </div>
        ) : null}

        <div ref={summaryRef} tabIndex={-1} role="alert" style={{ outline: "none" }}>
          {shownMessages.length > 0 ? (
            <div className={`${styles.strip} ${styles.stripAlert}`}>
              <WarningCircle weight="fill" aria-hidden />
              <div className="grow">
                <strong>
                  {shownMessages.length} to fix before continuing
                </strong>
                <ul className={styles.errorList}>
                  {[...new Set(shownMessages)].map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
        </div>

        {StepBody ? <StepBody s={s} ctx={ctx} errors={shownErrors} update={update} /> : <ReviewStep s={s} ctx={ctx} goTo={goTo} mode={mode.kind} />}

        {failure ? (
          <div className={`${styles.strip} ${styles.stripAlert} ${styles.stripFoot}`} role="alert">
            <WarningCircle weight="fill" aria-hidden />
            <div className="grow">
              {failure.code === "WALLET_REQUIRED" ? (
                <>
                  <strong>Connect a wallet before creating a deal</strong>
                  <p>
                    {failure.message} Progress is saved on this device. <Link className="ext" href="/settings">Open settings</Link>
                  </p>
                </>
              ) : failure.code === "TERMS_VERSION_STALE" ? (
                <>
                  <strong>This draft changed elsewhere</strong>
                  <p>
                    {failure.message}{" "}
                    <button type="button" className="btn ghost sm" onClick={() => window.location.reload()}>
                      Reload
                    </button>
                  </p>
                </>
              ) : (
                <>
                  <strong>{mode.kind === "create" ? "The draft was not created" : "The draft was not saved"}</strong>
                  <p>{failure.message}</p>
                  {failure.issues.length > 0 ? (
                    <ul className={styles.errorList}>
                      {failure.issues.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  ) : null}
                </>
              )}
            </div>
          </div>
        ) : null}

        <div className={styles.foot}>
          <div className="btn-group">
            {step > 0 ? (
              <button type="button" className="btn" onClick={() => goTo(step - 1)}>
                Back
              </button>
            ) : (
              <Link className="btn" href={mode.kind === "create" ? "/deals" : `/deals/${mode.dealId}`}>
                Cancel
              </Link>
            )}
          </div>
          {step < REVIEW_STEP ? (
            <button type="button" className="btn primary" onClick={next}>
              Next: {STEPS[step + 1]}
            </button>
          ) : (
            <div className="stack tight" style={{ alignItems: "flex-end" }}>
              <button type="button" className="btn primary" onClick={submit} disabled={busy || !ctx.buyer.address} aria-busy={busy}>
                {busy ? "Saving draft…" : mode.kind === "create" ? "Create draft" : "Save draft changes"}
              </button>
              {!ctx.buyer.address ? (
                <p className="why-not">
                  No wallet on {ctx.asset.networkLabel}. <Link className="ext" href="/settings">Connect one in Settings</Link>
                </p>
              ) : null}
            </div>
          )}
        </div>
      </section>

      <WizardPreview s={s} ctx={ctx} step={step} />
    </div>
  );
}
