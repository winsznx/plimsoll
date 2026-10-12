"use client";

import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, errorMessage } from "@/lib/api";

type Options = Parameters<typeof startRegistration>[0]["optionsJSON"];
type AuthOptions = Parameters<typeof startAuthentication>[0]["optionsJSON"];

export function PasskeySignIn() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const optionsJSON = await api<AuthOptions>("/auth/passkeys/authentication/options", { method: "POST" });
      const response = await startAuthentication({ optionsJSON });
      await api("/auth/passkeys/authentication/verify", { body: response });
      router.push("/overview");
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack tight">
      <button type="button" className="btn primary" onClick={signIn} disabled={busy}>
        {busy ? "Waiting for passkey…" : "Sign in with passkey"}
      </button>
      {error ? <p role="alert" className="small" style={{ color: "var(--held-ink)" }}>{error}</p> : null}
    </div>
  );
}

export function PasskeyRegister() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const optionsJSON = await api<Options>("/auth/passkeys/registration/options", {
        body: { email: form.get("email"), displayName: form.get("displayName"), orgLegalName: form.get("orgLegalName"), jurisdiction: form.get("jurisdiction") },
      });
      const response = await startRegistration({ optionsJSON });
      await api("/auth/passkeys/registration/verify", { body: response });
      router.push("/settings?welcome=1");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="form-grid" onSubmit={submit}>
      <label className="field">
        <span className="label">Work email</span>
        <input className="input" name="email" type="email" required autoComplete="email" />
      </label>
      <label className="field">
        <span className="label">Your name</span>
        <input className="input" name="displayName" required minLength={2} autoComplete="name" />
      </label>
      <label className="field">
        <span className="label">Organization legal name</span>
        <input className="input" name="orgLegalName" required minLength={2} autoComplete="organization" />
      </label>
      <label className="field">
        <span className="label">Jurisdiction</span>
        <input className="input" name="jurisdiction" required minLength={2} placeholder="e.g. United Kingdom" />
      </label>
      <div className="full stack tight">
        <p className="tiny muted">New organizations start unverified. Your passkey signs you in. Agreements are signed with a wallet.</p>
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? "Creating passkey…" : "Create account with passkey"}
        </button>
        {error ? <p role="alert" className="small" style={{ color: "var(--held-ink)" }}>{error}</p> : null}
      </div>
    </form>
  );
}
