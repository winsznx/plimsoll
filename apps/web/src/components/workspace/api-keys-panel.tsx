"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { Chip } from "@/components/chip";
import { useToast } from "@/components/toast";
import { SecretReveal } from "./secret-reveal";
import styles from "./workspace.module.css";

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export function ApiKeysPanel({ keys, adminBlocked }: { keys: ApiKeyRow[]; adminBlocked: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; key: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const locked = adminBlocked !== null;

  const create = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const name = String(new FormData(form).get("name") ?? "").trim();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ key: string; prefix: string }>("/api-keys", { body: { name } });
      setCreated({ name, key: r.key });
      form.reset();
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string, name: string) => {
    setBusy(true);
    try {
      await api<{ ok: true }>("/api-keys", { method: "DELETE", body: { id } });
      toast(`Key "${name}" revoked`);
      setConfirming(null);
      router.refresh();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      {created ? <SecretReveal title={`API key "${created.name}"`} value={created.key} onDismiss={() => setCreated(null)} /> : null}

      {keys.length === 0 ? (
        <p className="small muted">No keys issued yet.</p>
      ) : (
        <div className={styles.deliveries}>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Prefix</th>
                <th>Created</th>
                <th>Last used</th>
                <th>Status</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td className="small">{k.name}</td>
                  <td className="mono tiny">{k.prefix}…</td>
                  <td className="mono tiny">{fmtDateTime(k.createdAt)}</td>
                  <td className="mono tiny">{k.lastUsedAt ? fmtDateTime(k.lastUsedAt) : <span className="faint">Never</span>}</td>
                  <td>{k.revokedAt ? <Chip tone="blocked">Revoked</Chip> : <Chip tone="confirmed">Active</Chip>}</td>
                  <td>
                    {k.revokedAt ? (
                      <span className="tiny faint">{fmtDateTime(k.revokedAt)}</span>
                    ) : confirming === k.id ? (
                      <div className="btn-group">
                        <button type="button" className="btn sm danger" onClick={() => revoke(k.id, k.name)} disabled={busy}>
                          Confirm revoke
                        </button>
                        <button type="button" className="btn sm ghost" onClick={() => setConfirming(null)} disabled={busy}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button type="button" className="btn sm danger" onClick={() => setConfirming(k.id)} disabled={locked || busy}>
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form onSubmit={create} className="stack tight" aria-label="Create API key">
        <div className={styles.inlineForm}>
          <div className="field grow">
            <label htmlFor="key-name">Key name</label>
            <input id="key-name" name="name" className="input" required minLength={2} maxLength={60} placeholder="ERP sandbox sync" disabled={locked || busy} />
          </div>
          <button type="submit" className="btn primary" disabled={locked || busy}>
            {busy ? "Working…" : "Create sandbox key"}
          </button>
        </div>
        {adminBlocked ? <p className="why-not">{adminBlocked}</p> : null}
        <p className={`${styles.statusLine} ${styles.error}`} role="status" aria-live="polite">
          {error}
        </p>
      </form>
    </div>
  );
}
