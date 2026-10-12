"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, errorMessage, newIdempotencyKey } from "@/lib/api";
import { useToast } from "../toast";

const MIN = 5;
const MAX = 8000;

export function StatementForm({ dealId, disputeId }: { dealId: string; disputeId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const length = body.trim().length;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (length < MIN) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/deals/${dealId}/disputes/${disputeId}/statements`, { body: { body: body.trim() }, idempotencyKey: newIdempotencyKey() });
      toast("Statement added.");
      setBody("");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="stack tight" aria-label="Add a statement">
      <label className="field">
        <span className="label">Your statement</span>
        <textarea className="input" value={body} onChange={(e) => setBody(e.target.value)} minLength={MIN} maxLength={MAX} />
        <span className="hint">Off-chain. Seen by the parties and the resolver.{length > 0 ? ` ${length}/${MAX}` : ""}</span>
      </label>
      <div>
        <button type="submit" className="btn" disabled={busy || length < MIN}>
          {busy ? "Adding…" : "Add statement"}
        </button>
        {length < MIN && !busy ? <p className="why-not">Write at least {MIN} characters.</p> : null}
      </div>
      {error ? (
        <p className="small" role="alert" style={{ color: "var(--held-ink)" }}>
          {error}
        </p>
      ) : null}
    </form>
  );
}
