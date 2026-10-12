"use client";

import Link from "next/link";
import { useState } from "react";
import { api, errorMessage } from "@/lib/api";

export function ConfirmEmail({ token, signedIn }: { token: string; signedIn: boolean }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/auth/verify-email", { body: { token } });
      setDone(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack tight" aria-live="polite">
      {done ? (
        <>
          <p className="small" role="status">
            <strong>Email confirmed.</strong> Deals are unlocked.
          </p>
          <div>
            <Link className="btn primary" href={signedIn ? "/overview" : "/sign-in"}>
              {signedIn ? "Go to your workspace" : "Sign in"}
            </Link>
          </div>
        </>
      ) : (
        <div>
          <button type="button" className="btn primary" onClick={confirm} disabled={busy}>
            {busy ? "Confirming…" : "Confirm email"}
          </button>
        </div>
      )}
      {error ? (
        <p role="alert" className="small" style={{ color: "var(--alert)" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
