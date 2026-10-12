"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { DOCUMENT_TYPES, type DocumentType } from "@plimsoll/domain";
import type { DocumentView, MilestoneView } from "@/lib/views";
import { api, errorMessage, newIdempotencyKey } from "@/lib/api";
import { Chip } from "../chip";
import { useToast } from "../toast";
import { AnalysisChip, documentTypeLabel } from "./status";
import styles from "./documents.module.css";

export interface UploadTarget {
  documentType: string;
  documentId: string | null;
  nonce: number;
}

const UPLOAD_ROLES = ["buyer", "supplier", "forwarder", "inspector"];

function ChecklistStatus({ doc }: { doc: DocumentView | undefined }) {
  const latest = doc?.versions[0];
  if (!latest) return <Chip tone="awaiting">Missing</Chip>;
  if (latest.analysisState === "done") return <Chip tone="confirmed">Received v{latest.version}</Chip>;
  return <AnalysisChip state={latest.analysisState} />;
}

export function RequiredDocuments({ milestones, docs, canUpload, onUpload }: { milestones: MilestoneView[]; docs: DocumentView[]; canUpload: boolean; onUpload: (documentType: string, documentId: string | null) => void }) {
  const withDocs = milestones.filter((m) => m.requiredDocuments.length > 0);
  if (withDocs.length === 0) return <p className="small muted">No milestone needs documents.</p>;
  return (
    <div className={styles.required}>
      {withDocs.map((m) => (
        <div key={m.ordinal}>
          <p className={styles.colHead}>
            M{m.ordinal + 1} · {m.name}
          </p>
          <ul className={styles.checklist}>
            {m.requiredDocuments.map((t) => {
              const doc = docs.find((d) => d.documentType === t);
              return (
                <li key={t}>
                  <span className="small">{documentTypeLabel(t)}</span>
                  <ChecklistStatus doc={doc} />
                  {canUpload ? (
                    <button type="button" className="btn sm ghost" onClick={() => onUpload(t, doc?.id ?? null)}>
                      {doc ? "New version" : "Upload"}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function UploadForm({ dealId, docs, myRoles, target }: { dealId: string; docs: DocumentView[]; myRoles: string[]; target: UploadTarget | null }) {
  const router = useRouter();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [documentType, setDocumentType] = useState<string>(target?.documentType ?? "commercial_invoice");
  const [documentId, setDocumentId] = useState<string>(target?.documentId ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const canUpload = myRoles.some((r) => UPLOAD_ROLES.includes(r));
  const sameType = docs.filter((d) => d.documentType === documentType);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setStatus(null);
    const form = new FormData();
    form.set("file", file);
    form.set("documentType", documentType);
    if (documentId) form.set("documentId", documentId);
    try {
      const r = await api<{ documentId: string; versionId: string; version: number; sha256: string }>(`/deals/${dealId}/documents`, { form, idempotencyKey: newIdempotencyKey() });
      const text = `Uploaded ${documentTypeLabel(documentType).toLowerCase()} v${r.version} · sha256 ${r.sha256.slice(0, 12)}…. Analysis queued.`;
      setStatus({ tone: "ok", text });
      toast(text);
      setFile(null);
      setDocumentId(r.documentId);
      if (fileInput.current) fileInput.current.value = "";
      router.refresh();
    } catch (err) {
      setStatus({ tone: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  if (!canUpload) return <p className="why-not">Buyer, supplier, forwarder or inspector only.</p>;

  return (
    <form className="stack" style={{ gap: 14 }} onSubmit={submit} aria-describedby="upload-hint">
      {target?.documentId ? (
        <p className="callout" style={{ display: "block" }}>
          <strong>New version of the {documentTypeLabel(target.documentType).toLowerCase()}.</strong> Earlier versions keep their hashes.
        </p>
      ) : null}
      <label className="field">
        <span className="label">Document type</span>
        <select
          className="input"
          value={documentType}
          onChange={(e) => {
            setDocumentType(e.target.value);
            setDocumentId("");
          }}
        >
          {DOCUMENT_TYPES.map((t: DocumentType) => (
            <option key={t} value={t}>
              {documentTypeLabel(t)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="label">Upload as</span>
        <select className="input" value={documentId} onChange={(e) => setDocumentId(e.target.value)}>
          <option value="">New document</option>
          {sameType.map((d) => (
            <option key={d.id} value={d.id}>
              New version of {d.title} (now v{d.versions[0]?.version ?? 0})
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="label">File</span>
        <input ref={fileInput} className="input" type="file" accept="application/pdf,text/plain,.pdf,.txt" required autoFocus={Boolean(target)} onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ paddingTop: 9 }} />
        <span className="hint" id="upload-hint">
          PDF or text, up to 20 MB. Stored unchanged and hashed with SHA-256.
        </span>
      </label>
      <div>
        <button type="submit" className="btn primary" disabled={busy || !file}>
          {busy ? "Uploading…" : documentId ? "Upload new version" : "Upload and analyse"}
        </button>
        {!file && !busy ? <p className="why-not">Choose a file first.</p> : null}
      </div>
      <p aria-live="polite" className="small" style={{ color: status?.tone === "error" ? "var(--held-ink)" : undefined }} role={status?.tone === "error" ? "alert" : undefined}>
        {status?.text ?? ""}
      </p>
    </form>
  );
}
