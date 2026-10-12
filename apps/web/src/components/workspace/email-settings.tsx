"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Chip } from "@/components/chip";
import { EnvelopeSimple } from "@phosphor-icons/react";
import { api, errorMessage } from "@/lib/api";
import styles from "./workspace.module.css";

type Delivery = "sent" | "logged" | "bounced" | "failed";

const DELIVERY_NOTE: Record<Delivery, string> = {
  sent: "Sent. Use the newest link. Earlier links no longer work.",
  logged: "Email is off on this server. The link went to the server log.",
  bounced: "The address rejected it. Check it is correct.",
  failed: "Sending failed. Try again in a minute.",
};

function ResendButton() {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const resend = async () => {
    setBusy(true);
    try {
      const r = await api<{ alreadyVerified: boolean; delivery: Delivery | null }>("/auth/verify-email/resend", { method: "POST" });
      setNote(r.alreadyVerified ? "This address is already verified." : DELIVERY_NOTE[r.delivery ?? "failed"]);
    } catch (e) {
      setNote(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack tight">
      <div>
        <button type="button" className="btn sm" onClick={resend} disabled={busy}>
          {busy ? "Sending…" : "Resend verification email"}
        </button>
      </div>
      <p className={styles.statusLine} role="status" aria-live="polite">
        {note}
      </p>
    </div>
  );
}

/** Shown only while the signed-in user's address is unverified. */
export function EmailVerificationBanner({ email, verified }: { email: string; verified: boolean }) {
  if (verified) return null;
  return (
    <div className={styles.banner}>
      <EnvelopeSimple weight="fill" aria-hidden />
      <div className="stack tight">
        <p>
          <strong>Confirm {email} to create deals.</strong> Creating deals, submitting terms and inviting stay locked until then. The link expires in 24 hours.
        </p>
        <ResendButton />
      </div>
    </div>
  );
}

export function EmailPanel({ email, verified, notifications, isDemo }: { email: string; verified: boolean; notifications: boolean; isDemo: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = isDemo ? "Demo personas never receive email." : !verified ? "Verify this address first." : null;

  const toggle = async (next: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await api("/me", { method: "PATCH", body: { emailNotifications: next } });
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel" id="email" aria-labelledby="email-h">
      <div className="panel-head">
        <h2 id="email-h" style={{ fontSize: 15 }}>
          Email
        </h2>
        {verified ? <Chip tone="confirmed">Verified</Chip> : <Chip tone="awaiting">Not verified</Chip>}
      </div>
      <div className="panel-body stack tight">
        <p className="small mono">{email}</p>
        <label className={styles.toggle} style={blocked ? { cursor: "default" } : undefined}>
          <input type="checkbox" checked={notifications && !isDemo} disabled={busy || blocked !== null} onChange={(e) => toggle(e.target.checked)} />
          <span className="small">Email me when a deal needs my attention</span>
        </label>
        {blocked ? <p className="why-not">{blocked}</p> : null}
        <p className="tiny faint">Title and link only. Never documents, amounts or addresses.</p>
        <p className={`${styles.statusLine} ${styles.error}`} role="status" aria-live="polite">
          {error}
        </p>
      </div>
    </section>
  );
}
