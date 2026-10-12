"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { Chip, type ChipTone } from "@/components/chip";
import { useToast } from "@/components/toast";
import { SecretReveal } from "./secret-reveal";
import styles from "./workspace.module.css";

export interface WebhookDelivery {
  id: string;
  eventType: string;
  status: string;
  attempts: number;
  responseCode: number | null;
  lastError: string | null;
  createdAt: string;
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  status: string;
  createdAt: string;
  secretPreview: string;
  deliveries: WebhookDelivery[];
}

interface Props {
  endpoints: WebhookEndpoint[];
  events: readonly string[];
  /** Null for admins; otherwise why the controls are disabled. */
  adminBlocked: string | null;
}

const DELIVERY_TONE: Record<string, [ChipTone, string]> = {
  delivered: ["confirmed", "Delivered"],
  pending: ["awaiting", "Retrying"],
  failed: ["blocked", "Failed"],
};

function deliveryChip(d: WebhookDelivery) {
  if (d.status === "pending" && d.attempts === 0) return <Chip tone="awaiting">Queued</Chip>;
  const [tone, label] = DELIVERY_TONE[d.status] ?? ["neutral", d.status];
  return <Chip tone={tone}>{label}</Chip>;
}

export function WebhooksPanel({ endpoints, events, adminBlocked }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ url: string; secret: string } | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const locked = adminBlocked !== null;

  const create = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const url = String(data.get("url") ?? "").trim();
    const chosen = data.getAll("events").map(String);
    if (chosen.length === 0) {
      setError("Choose at least one event to subscribe to.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: string; secret: string }>("/webhooks", { body: { url, events: chosen } });
      setCreated({ url, secret: r.secret });
      form.reset();
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async (id: string) => {
    setTesting(id);
    try {
      await api<{ ok: true }>(`/webhooks/${id}/test`, { method: "POST" });
      toast("Test delivery queued. The worker sends it within a few seconds.");
      router.refresh();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className="stack">
      {created ? <SecretReveal title={`Signing secret for ${created.url}`} value={created.secret} onDismiss={() => setCreated(null)} /> : null}

      {endpoints.length === 0 ? (
        <p className="small muted">No endpoints yet.</p>
      ) : (
        endpoints.map((ep) => (
          <article key={ep.id} className={styles.endpoint} aria-label={`Webhook ${ep.url}`}>
            <div className={styles.endpointHead}>
              <div style={{ minWidth: 0 }}>
                <p className={styles.endpointUrl}>{ep.url}</p>
                <p className={styles.endpointMeta}>
                  Secret {ep.secretPreview} · {fmtDateTime(ep.createdAt)} · {ep.events.join(", ")}
                </p>
              </div>
              <div className="row wrap" style={{ gap: 8 }}>
                <Chip tone={ep.status === "active" ? "confirmed" : "neutral"}>{ep.status}</Chip>
                <button type="button" className="btn sm" onClick={() => sendTest(ep.id)} disabled={locked || testing === ep.id}>
                  {testing === ep.id ? "Queuing…" : "Send test delivery"}
                </button>
              </div>
            </div>
            <div className={styles.deliveries}>
              {ep.deliveries.length === 0 ? (
                <p className="small muted" style={{ padding: "10px 12px" }}>No deliveries yet. Send a test.</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Created</th>
                      <th>Event</th>
                      <th>Status</th>
                      <th className="num">Attempts</th>
                      <th className="num">Response</th>
                      <th>Last error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ep.deliveries.map((d) => (
                      <tr key={d.id}>
                        <td className="mono tiny" style={{ whiteSpace: "nowrap" }}>
                          {fmtDateTime(d.createdAt)}
                        </td>
                        <td className="mono tiny">{d.eventType}</td>
                        <td>{deliveryChip(d)}</td>
                        <td className="num">{d.attempts}</td>
                        <td className="num">{d.responseCode ?? <span className="faint">-</span>}</td>
                        <td className="tiny muted" style={{ maxWidth: 260, overflowWrap: "anywhere" }}>
                          {d.lastError ?? <span className="faint">-</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </article>
        ))
      )}
      {endpoints.length > 0 ? (
        <div>
          <button type="button" className="btn sm ghost" onClick={() => router.refresh()}>
            Refresh delivery status
          </button>
        </div>
      ) : null}

      <form onSubmit={create} className={`stack tight ${styles.addForm}`} aria-label="Add webhook endpoint">
        <h3 className={styles.subhead}>Add an endpoint</h3>
        <div className="field">
          <label htmlFor="wh-url">Endpoint URL</label>
          <input id="wh-url" name="url" type="url" className="input mono" required placeholder="https://example.com/plimsoll/events" disabled={locked || busy} />
          <span className="hint">HTTPS only. http://localhost allowed for testing.</span>
        </div>
        <fieldset className={styles.checks} disabled={locked || busy}>
          <legend className="small" style={{ fontWeight: 550, marginBottom: 2 }}>
            Events
          </legend>
          {events.map((ev) => (
            <label key={ev}>
              <input type="checkbox" name="events" value={ev} />
              {ev}
            </label>
          ))}
        </fieldset>
        <div>
          <button type="submit" className="btn primary" disabled={locked || busy}>
            {busy ? "Adding…" : "Add endpoint"}
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
