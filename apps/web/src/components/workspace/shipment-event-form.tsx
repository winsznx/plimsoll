"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, errorMessage } from "@/lib/api";
import { useToast } from "@/components/toast";
import styles from "./workspace.module.css";

const EVENT_CODES = [
  ["BOOKED", "Booked"],
  ["GATE_IN", "Gate in at origin"],
  ["HANDED_TO_CARRIER", "Handed to carrier"],
  ["LOADED", "Loaded on board"],
  ["DEPARTED", "Departed"],
  ["ARRIVED", "Arrived"],
  ["DISCHARGED", "Discharged"],
  ["DELIVERED", "Delivered"],
] as const;

const SOURCES = [
  ["manual", "Manual entry"],
  ["carrier_api", "Carrier API"],
  ["edi", "EDI message"],
] as const;

interface Props {
  dealId: string;
  reference: string;
  /** Null when the user may record; otherwise the reason they cannot. */
  recordBlocked: string | null;
  attestBlocked: string | null;
}

export function ShipmentEventForm({ dealId, reference, recordBlocked, attestBlocked }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const occurred = String(data.get("occurredAt") ?? "");
    const occurredDate = new Date(occurred);
    if (!occurred || Number.isNaN(occurredDate.getTime())) {
      setError("Enter when the event happened.");
      return;
    }
    const sourceRef = String(data.get("sourceRef") ?? "").trim();
    const attest = data.get("attest") === "on";
    setBusy(true);
    setError(null);
    try {
      await api<{ ok: true }>(`/deals/${dealId}/shipment/events`, {
        body: {
          eventCode: String(data.get("eventCode")),
          description: String(data.get("description") ?? "").trim(),
          occurredAt: occurredDate.toISOString(),
          sourceType: String(data.get("sourceType")),
          sourceRef: sourceRef || null,
          attest,
        },
      });
      form.reset();
      toast(attest ? `Attested event recorded on ${reference}` : `Event recorded on ${reference}`);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const disabled = busy || recordBlocked !== null;

  return (
    <form onSubmit={submit} className="stack tight" aria-describedby={recordBlocked ? "record-why-not" : undefined}>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="ev-code">Event</label>
          <select id="ev-code" name="eventCode" className="input" required disabled={disabled} defaultValue="DEPARTED">
            {EVENT_CODES.map(([code, label]) => (
              <option key={code} value={code}>
                {label} ({code})
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ev-at">Occurred at</label>
          <input id="ev-at" name="occurredAt" type="datetime-local" className="input" required disabled={disabled} />
          <span className="hint">Local time. Stored in UTC.</span>
        </div>
        <div className="field full">
          <label htmlFor="ev-desc">Description</label>
          <textarea id="ev-desc" name="description" className="input" required minLength={3} maxLength={400} disabled={disabled} placeholder="What happened, where, and what backs it" />
        </div>
        <div className="field">
          <label htmlFor="ev-source">Source</label>
          <select id="ev-source" name="sourceType" className="input" disabled={disabled} defaultValue="manual">
            {SOURCES.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ev-ref">Source reference</label>
          <input id="ev-ref" name="sourceRef" className="input mono" maxLength={200} disabled={disabled} placeholder="Optional. Message or booking id" />
        </div>
      </div>

      <div className={styles.attestBox}>
        <label className={styles.check}>
          <input type="checkbox" name="attest" disabled={disabled || attestBlocked !== null} aria-describedby="attest-help" />
          <span>
            <strong>Attest with my appointed signing address</strong>
            <span id="attest-help" className="tiny muted" style={{ display: "block", marginTop: 2 }}>
              Signed context for approvers. Only on-chain approvals release funds.
            </span>
          </span>
        </label>
        {attestBlocked && !recordBlocked ? <p className="why-not">{attestBlocked}</p> : null}
      </div>

      <div className="spread" style={{ flexWrap: "wrap" }}>
        <span className="tiny faint">Stage advances from the event code.</span>
        <button type="submit" className="btn primary" disabled={disabled}>
          {busy ? "Recording…" : "Record event"}
        </button>
      </div>
      {recordBlocked ? (
        <p className="why-not" id="record-why-not">
          {recordBlocked}
        </p>
      ) : null}
      <p className={`${styles.statusLine} ${styles.error}`} role="status" aria-live="polite">
        {error}
      </p>
    </form>
  );
}
