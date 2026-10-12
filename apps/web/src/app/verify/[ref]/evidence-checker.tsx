"use client";

import { ArrowsClockwise, FileArrowUp } from "@phosphor-icons/react";
import { useState, type DragEvent } from "react";
import { DOCUMENT_TYPE_LABELS, evidenceDigest, sha256Hex, type EvidenceManifest } from "@plimsoll/domain";
import { Chip } from "@/components/chip";
import styles from "./verify.module.css";

export interface CheckableMilestone {
  ordinal: number;
  name: string;
  evidenceDigest: string | null;
  manifest: EvidenceManifest | null;
}

interface HashedFile {
  name: string;
  bytes: number;
  sha256: string;
}

interface DigestCheck {
  ordinal: number;
  computed: string;
  matches: boolean;
}

function docLabel(type: string): string {
  const labels: Record<string, string | undefined> = DOCUMENT_TYPE_LABELS;
  return labels[type] ?? type;
}

/** Hashing happens in this browser with Web Crypto; files are never uploaded. */
export function EvidenceChecker({ milestones }: { milestones: CheckableMilestone[] }) {
  const [files, setFiles] = useState<HashedFile[]>([]);
  const [hashing, setHashing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<DigestCheck[] | null>(null);
  const [computing, setComputing] = useState(false);

  const anchored = milestones.filter((m): m is CheckableMilestone & { manifest: EvidenceManifest; evidenceDigest: string } => m.manifest !== null && m.evidenceDigest !== null);
  const known = anchored.flatMap((m) => m.manifest.documents.map((d) => ({ ...d, milestone: m })));

  const hashFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setHashing(true);
    setError(null);
    try {
      const hashed = await Promise.all(Array.from(list, async (f) => ({ name: f.name, bytes: f.size, sha256: await sha256Hex(new Uint8Array(await f.arrayBuffer())) })));
      setFiles((prev) => [...hashed, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? `Could not hash the file: ${e.message}` : "Could not hash the file.");
    } finally {
      setHashing(false);
    }
  };

  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setDragging(false);
    void hashFiles(e.dataTransfer.files);
  };

  const recompute = async () => {
    setComputing(true);
    setError(null);
    try {
      const results = await Promise.all(
        anchored.map(async (m) => {
          const computed = await evidenceDigest(m.manifest);
          return { ordinal: m.ordinal, computed, matches: computed === m.evidenceDigest };
        }),
      );
      setChecks(results);
    } catch (e) {
      setError(e instanceof Error ? `Could not recompute: ${e.message}` : "Could not recompute the digests.");
    } finally {
      setComputing(false);
    }
  };

  return (
    <section className="panel" aria-labelledby="checker-title">
      <div className="panel-head">
        <div>
          <h2 id="checker-title" style={{ fontSize: 15 }}>
            Check it yourself
          </h2>
          <p className="sub">Runs in your browser. Files never leave this device.</p>
        </div>
      </div>
      <div className={styles.checkGrid}>
        <div>
          <h3>Match your files</h3>
          <label
            className={`${styles.drop} ${dragging ? styles.dropActive : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <FileArrowUp aria-hidden />
            <span>Drop documents or choose files. Each SHA-256 is checked against every anchored manifest.</span>
            <input
              type="file"
              multiple
              onChange={(e) => {
                void hashFiles(e.currentTarget.files);
                e.currentTarget.value = "";
              }}
            />
          </label>
          {known.length === 0 ? <p className="tiny muted">No anchored manifest lists documents yet. Hashes still show for your records.</p> : null}
          <div aria-live="polite">
            {hashing ? <p className="small muted">Hashing…</p> : null}
            {files.length > 0 ? (
              <ul className={styles.results}>
                {files.map((f, i) => {
                  const hits = known.filter((k) => k.sha256 === f.sha256);
                  return (
                    <li key={`${f.sha256}-${i}`}>
                      <span className="spread">
                        <strong style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{f.name}</strong>
                        {hits.length > 0 ? <Chip tone="confirmed">Matches</Chip> : <Chip tone="blocked">No match</Chip>}
                      </span>
                      <span className={styles.hex}>sha256 {f.sha256}</span>
                      <span className="tiny muted">
                        {hits.length > 0
                          ? hits.map((h) => `${docLabel(h.documentType)} v${h.version}, M${h.milestone.ordinal + 1} (${h.milestone.name})`).join("; ")
                          : "Not byte-identical to any anchored document. A re-saved or re-scanned copy hashes differently."}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        </div>

        <div>
          <h3>Recompute the evidence digests</h3>
          <p className="small muted">Rebuilds each digest from the manifest above and compares it with the contract.</p>
          <div>
            <button type="button" className="btn" onClick={recompute} disabled={computing || anchored.length === 0}>
              <ArrowsClockwise aria-hidden />
              {computing ? "Recomputing…" : "Recompute digests"}
            </button>
            {anchored.length === 0 ? <p className="why-not">No milestone has evidence anchored yet.</p> : null}
          </div>
          <div aria-live="polite">
            {checks ? (
              <ul className={styles.results}>
                {checks.map((c) => {
                  const m = anchored.find((x) => x.ordinal === c.ordinal);
                  const redacted = (m?.manifest.findings.length ?? 0) > 0;
                  return (
                    <li key={c.ordinal}>
                      <span className="spread">
                        <strong style={{ fontWeight: 600 }}>
                          M{c.ordinal + 1} {m ? m.name : ""}
                        </strong>
                        {c.matches ? <Chip tone="confirmed">Digest matches</Chip> : <Chip tone={redacted ? "attention" : "blocked"}>{redacted ? "Cannot match here" : "Mismatch"}</Chip>}
                      </span>
                      <span className={styles.hex}>computed {c.computed}</span>
                      <span className={styles.hex}>on chain {m?.evidenceDigest}</span>
                      {!c.matches ? (
                        <span className="tiny muted">
                          {redacted
                            ? "Reviewer reasons are redacted here, so this digest can't be rebuilt. The parties' export has the full manifest."
                            : "The manifest here does not reproduce the on-chain digest. Treat this evidence as unverified."}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        </div>
      </div>
      {error ? (
        <p role="alert" className="small" style={{ color: "var(--held-ink)", padding: "0 18px 16px" }}>
          {error}
        </p>
      ) : null}
    </section>
  );
}
