"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { shortAddress } from "@/lib/format";

export interface InviteWallet {
  address: string;
  label: string;
  custodial: boolean;
}

export function AcceptInvite({ token, wallets, networkLabel }: { token: string; wallets: InviteWallet[]; networkLabel: string }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(wallets.length === 1 ? (wallets[0]?.address ?? null) : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (wallets.length === 0) {
    return (
      <div className="stack tight">
        <button type="button" className="btn primary" disabled>
          Accept invitation
        </button>
        <p className="why-not">
          Needs a {networkLabel} wallet. <Link className="ext" href="/settings">Connect Freighter in settings</Link>, then reopen this link.
        </p>
      </div>
    );
  }

  const accept = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const { dealId } = await api<{ dealId: string }>(`/invites/${encodeURIComponent(token)}/accept`, { body: { signingAddress: selected } });
      router.push(`/deals/${dealId}`);
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <div className="stack tight">
      <fieldset style={{ border: 0, margin: 0, padding: 0 }} className="stack tight">
        <legend className="small" style={{ fontWeight: 600, marginBottom: 8 }}>
          Sign with
        </legend>
        {wallets.map((w) => (
          <label key={w.address} className="panel row" style={{ padding: "12px 14px", minHeight: 44, cursor: "pointer" }}>
            <input type="radio" name="signing-address" value={w.address} checked={selected === w.address} onChange={() => setSelected(w.address)} />
            <span className="grow">
              <span style={{ display: "block", fontWeight: 600 }}>{w.custodial ? "Demo custody (testnet)" : w.label}</span>
              <span className="mono tiny faint" title={w.address}>
                {shortAddress(w.address, 6, 6)}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="tiny muted">This address becomes your signing key in the terms. Changing it after freeze needs a new version.</p>
      <div>
        <button type="button" className="btn primary" onClick={accept} disabled={busy || !selected}>
          {busy ? "Accepting…" : "Accept invitation"}
        </button>
        {!selected ? <p className="why-not">Choose the wallet you will sign with.</p> : null}
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
