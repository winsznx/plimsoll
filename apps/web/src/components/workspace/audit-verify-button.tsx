"use client";

import { ShieldCheck } from "@phosphor-icons/react";
import { useState } from "react";
import { api, errorMessage } from "@/lib/api";

type Result = { kind: "idle" } | { kind: "checking" } | { kind: "done"; checked: number; brokenAt: number | null } | { kind: "error"; message: string };

/** Recomputes the audit hash chain on the server; any edited or deleted row breaks the links after it. */
export function AuditVerifyButton() {
  const [result, setResult] = useState<Result>({ kind: "idle" });

  const verify = async () => {
    setResult({ kind: "checking" });
    try {
      const r = await api<{ checked: number; brokenAt: number | null }>("/audit/verify");
      setResult({ kind: "done", ...r });
    } catch (e) {
      setResult({ kind: "error", message: errorMessage(e) });
    }
  };

  return (
    <div className="stack tight" style={{ alignItems: "flex-end" }}>
      <button type="button" className="btn" onClick={verify} disabled={result.kind === "checking"}>
        <ShieldCheck aria-hidden />
        {result.kind === "checking" ? "Verifying…" : "Verify audit chain"}
      </button>
      <p className="tiny" role="status" aria-live="polite" style={{ textAlign: "right", maxWidth: 320 }}>
        {result.kind === "done" && result.brokenAt === null ? <span style={{ color: "var(--signal-ink)", fontWeight: 600 }}>Intact. {result.checked} entries recomputed.</span> : null}
        {result.kind === "done" && result.brokenAt !== null ? (
          <span style={{ color: "var(--held-ink)", fontWeight: 600 }}>
            Broken at #{result.brokenAt} of {result.checked}. Entries from there are untrusted.
          </span>
        ) : null}
        {result.kind === "error" ? <span style={{ color: "var(--held-ink)" }}>Could not verify: {result.message}</span> : null}
      </p>
    </div>
  );
}
