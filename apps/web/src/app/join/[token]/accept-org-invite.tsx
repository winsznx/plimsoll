"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "@/lib/api";

export function AcceptOrgInvite({ token, orgName }: { token: string; orgName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/org/invites/${encodeURIComponent(token)}/accept`, { method: "POST" });
      router.push("/settings#members");
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <div className="stack tight">
      <p className="tiny muted">Accepting switches your workspace to {orgName}. Other organizations stay in the switcher.</p>
      <div>
        <button type="button" className="btn primary" onClick={accept} disabled={busy}>
          {busy ? "Joining…" : `Join ${orgName}`}
        </button>
      </div>
      <div aria-live="polite">
        {error ? (
          <p role="alert" className="small" style={{ color: "var(--alert)" }}>
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
