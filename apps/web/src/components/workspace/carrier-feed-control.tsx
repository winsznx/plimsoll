"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { useToast } from "@/components/toast";
import styles from "./workspace.module.css";

interface Props {
  dealId: string;
  reference: string;
  attached: { id: string; label: string } | null;
  options: { id: string; label: string }[];
  /** Null when the user may change the feed; otherwise the reason they cannot. */
  blocked: string | null;
}

export function CarrierFeedControl({ dealId, reference, attached, options, blocked }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [choice, setChoice] = useState(options[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = async (provider: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ provider: string | null; imported: number }>(`/deals/${dealId}/shipment/provider`, { body: { provider } });
      toast(provider ? `Feed attached to ${reference}${r.imported > 0 ? `; ${r.imported} event${r.imported === 1 ? "" : "s"} imported` : ""}` : `Feed detached from ${reference}`);
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const disabled = busy || blocked !== null;

  return (
    <div className="stack tight" style={{ marginTop: 14 }}>
      {attached ? (
        <div className="row wrap">
          <button type="button" className="btn" disabled={disabled} onClick={() => change(null)} aria-describedby={blocked ? "feed-why-not" : undefined}>
            {busy ? "Detaching…" : "Detach feed"}
          </button>
        </div>
      ) : (
        <div className="row wrap" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ flex: "1 1 220px" }}>
            <label htmlFor="feed-provider">Feed</label>
            <select id="feed-provider" className="input" value={choice} disabled={disabled} onChange={(e) => setChoice(e.target.value)}>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="btn" disabled={disabled || !choice} onClick={() => change(choice)} aria-describedby={blocked ? "feed-why-not" : undefined}>
            {busy ? "Attaching…" : "Attach feed"}
          </button>
        </div>
      )}
      {blocked ? (
        <p className="why-not" id="feed-why-not">
          {blocked}
        </p>
      ) : null}
      <p className={`${styles.statusLine} ${styles.error}`} role="status" aria-live="polite">
        {error}
      </p>
    </div>
  );
}
