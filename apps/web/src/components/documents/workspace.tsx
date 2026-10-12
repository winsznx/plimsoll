"use client";

import { useMemo, useState } from "react";
import type { DiscrepancyView, DocumentView, MilestoneView } from "@/lib/views";
import { FindingDetail, FindingsList } from "./findings";
import { ACTIVE_STATES, defaultPair, heldBy, indexVersions, sideLabel, sortFindings, versionLabel } from "./model";
import { PaperPane } from "./paper-pane";
import { RequiredDocuments, UploadForm, type UploadTarget } from "./upload-panel";
import styles from "./documents.module.css";

const ZOOMS = [
  { value: 1, label: "Fit" },
  { value: 1.5, label: "150%" },
  { value: 2, label: "200%" },
];

interface Props {
  dealId: string;
  docs: DocumentView[];
  findings: DiscrepancyView[];
  milestones: MilestoneView[];
  myRoles: string[];
  termsVersion: number;
}

export function DocumentWorkspace({ dealId, docs, findings, milestones, myRoles, termsVersion }: Props) {
  const index = useMemo(() => indexVersions(docs), [docs]);
  const sorted = useMemo(() => sortFindings(findings), [findings]);
  const [pick, setPick] = useState<{ left: string | null; right: string | null }>({ left: null, right: null });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [uploadTarget, setUploadTarget] = useState<UploadTarget | null>(null);

  const [defaultLeft, defaultRight] = defaultPair(docs);
  const left = pick.left && index.has(pick.left) ? pick.left : defaultLeft;
  const right = pick.right && index.has(pick.right) ? pick.right : defaultRight;
  const selected = sorted.find((f) => f.id === selectedId) ?? sorted.find((f) => f.active && ACTIVE_STATES.has(f.state)) ?? null;
  const activeCount = sorted.filter((f) => f.active && ACTIVE_STATES.has(f.state)).length;
  const blockingCount = sorted.filter((f) => f.active && ACTIVE_STATES.has(f.state) && f.severity === "blocking").length;

  /** Brings both sides of a finding into the panes so its highlight is visible without hunting. */
  const selectFinding = (f: DiscrepancyView) => {
    setSelectedId(f.id);
    const shown = [left, right];
    const actual = f.actual.versionId && index.has(f.actual.versionId) ? f.actual.versionId : null;
    const expected = f.expected.versionId && index.has(f.expected.versionId) ? f.expected.versionId : null;
    if (actual && !shown.includes(actual)) {
      const actualDoc = index.get(actual)!.doc.id;
      const keepLeft = left && index.get(left)?.doc.id !== actualDoc ? left : null;
      setPick({ left: expected ?? keepLeft ?? defaultLeft, right: actual });
    } else if (expected && !shown.includes(expected)) {
      setPick({ left: expected, right: actual ?? right });
    }
  };

  const requestUpload = (documentType: string, documentId: string | null) => {
    setUploadTarget((t) => ({ documentType, documentId, nonce: (t?.nonce ?? 0) + 1 }));
    document.getElementById("upload")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const versionOptions = docs.flatMap((d) => d.versions.map((v) => ({ id: v.id, label: versionLabel(index.get(v.id)!) })));
  const canUpload = myRoles.some((r) => ["buyer", "supplier", "forwarder", "inspector"].includes(r));

  return (
    <div className="stack">
      <section className="panel" aria-labelledby="findings-title">
        <div className="panel-head">
          <h2 id="findings-title" style={{ fontSize: 15 }}>
            Findings
          </h2>
          <span className={styles.headCount}>
            {activeCount} open · {blockingCount} blocking · {sorted.length} on record
          </span>
        </div>
        <div>
          <FindingsList findings={sorted} selectedId={selected?.id ?? null} onSelect={selectFinding} holdsOf={(f) => heldBy(f, milestones)} />
          {selected ? (
            <div className={styles.findingDetail}>
              <FindingDetail
                dealId={dealId}
                finding={selected}
                index={index}
                termsVersion={termsVersion}
                myRoles={myRoles}
                onRequestUpload={(f) => requestUpload(f.actual.documentType, f.actual.documentId)}
              />
            </div>
          ) : null}
        </div>
      </section>

      <section className="panel" aria-labelledby="compare-title">
        <div className={`panel-head ${styles.compareHead}`}>
          <h2 id="compare-title" style={{ fontSize: 15 }}>
            Source papers
          </h2>
          {versionOptions.length > 0 ? (
            <div className={styles.compareControls}>
              <label className="field">
                <span className="label">Left</span>
                <select className="input" value={left ?? ""} onChange={(e) => setPick({ left: e.target.value, right })}>
                  {versionOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="label">Right</span>
                <select className="input" value={right ?? ""} onChange={(e) => setPick({ left, right: e.target.value })}>
                  {versionOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="field">
                <span className="label" id="zoom-label">
                  Zoom
                </span>
                <div className={styles.segmented} role="group" aria-labelledby="zoom-label">
                  {ZOOMS.map((z) => (
                    <button key={z.value} type="button" aria-pressed={zoom === z.value} onClick={() => setZoom(z.value)}>
                      {z.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>
        {docs.length === 0 ? (
          <p className="empty">
            <strong>No documents yet</strong>
            Upload the invoice and packing list to compare them.
          </p>
        ) : (
          <>
            <div className={`compare ${styles.compare}`}>
              <PaperPane dealId={dealId} refItem={left ? (index.get(left) ?? null) : null} finding={selected} zoom={zoom} side="Left" />
              <div className="seam-divider" aria-hidden="true" />
              <PaperPane dealId={dealId} refItem={right ? (index.get(right) ?? null) : null} finding={selected} zoom={zoom} side="Right" />
            </div>
            {selected ? (
              <div className={styles.annotation} aria-live="polite">
                <span className={styles.findingRule}>{selected.ruleId}</span>
                <span className="small">
                  <span className={styles.legendHit}>≠</span> found <strong className="mono">{selected.actual.value ?? "nothing"}</strong> in {sideLabel(selected.actual, index, termsVersion)}
                </span>
                <span className="small">
                  <span className={styles.legendOk}>=</span> expected <strong className="mono">{selected.expected.value ?? "none"}</strong> from {sideLabel(selected.expected, index, termsVersion)}
                </span>
              </div>
            ) : null}
          </>
        )}
      </section>

      <section className="panel" id="upload" aria-labelledby="upload-title">
        <div className="panel-head">
          <h2 id="upload-title" style={{ fontSize: 15 }}>
            Required documents
          </h2>
          <span className={styles.headCount}>Per milestone, from the terms</span>
        </div>
        <div className={styles.intake}>
          <RequiredDocuments milestones={milestones} docs={docs} canUpload={canUpload} onUpload={requestUpload} />
          <div className={styles.uploadCol}>
            <h3 className={styles.colHead}>Upload</h3>
            <UploadForm key={uploadTarget?.nonce ?? 0} dealId={dealId} docs={docs} myRoles={myRoles} target={uploadTarget} />
          </div>
        </div>
      </section>
    </div>
  );
}
