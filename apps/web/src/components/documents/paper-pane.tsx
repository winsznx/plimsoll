"use client";

import { useEffect, useState } from "react";
import type { SourceSpan } from "@plimsoll/domain";
import type { DiscrepancyView, FieldView } from "@/lib/views";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { AnalysisChip } from "./status";
import { lineIndexFor, marksFor, spanKey, versionLabel, type Analysis, type Mark, type MarkedSpan, type VersionRef } from "./model";
import styles from "./documents.module.css";

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 18;
const MONO_ADVANCE = 0.6;
/** Blank vertical bands taller than this are shortened so a footer doesn't push the body out of view. */
const GAP_MAX = 56;
const GAP_KEEP = 22;

type Box = [number, number, number, number];

interface PaperLine {
  key: string;
  span: SourceSpan;
  mark: Mark | undefined;
}

interface Placed extends PaperLine {
  left: number;
  top: number;
  fontSize: number;
}

interface Layout {
  width: number;
  height: number;
  placed: Placed[];
  breaks: number[];
}

type Loaded = { versionId: string; analysis: Analysis | null; error: string | null };

/**
 * Whole-page lines when the extractor returned them; older analyses fall back to the spans of
 * rule-extracted fields. Model spans have no position, so they never enter the replica.
 */
function pageLines(analysis: Analysis): SourceSpan[] {
  if (analysis.lines?.length) return analysis.lines;
  const seen = new Map<string, SourceSpan>();
  for (const s of [...analysis.fields.filter((f) => f.method !== "model").map((f) => f.span), ...analysis.lineItems.map((l) => l.span)]) seen.set(spanKey(s), s);
  return [...seen.values()];
}

function withMarks(lines: SourceSpan[], marked: MarkedSpan[]): PaperLine[] {
  const byLine = new Map<number, Mark>();
  for (const m of marked) {
    const i = lineIndexFor(lines, m.span);
    if (i >= 0 && byLine.get(i)?.tone !== "hit") byLine.set(i, { tone: m.tone, value: m.value });
  }
  return lines.map((span, i) => ({ key: `${i}|${spanKey(span)}`, span, mark: byLine.get(i) }));
}

function fontSizeOf(span: SourceSpan): number {
  return (span.bbox?.[3] ?? 10) * 0.92;
}

/** The replica uses a monospace face, which runs wider than the PDF's proportional type. */
function monoWidth(span: SourceSpan): number {
  return span.text.length * MONO_ADVANCE * fontSizeOf(span);
}

/**
 * Clips the page to the area that holds text and shortens long blank bands, so the replica stays
 * legible in a half-width pane. Positions are percentages of the clipped region.
 */
function layoutOf(lines: PaperLine[]): Layout {
  const boxed = lines.filter((l): l is PaperLine & { span: SourceSpan & { bbox: Box } } => l.span.bbox !== null).sort((a, b) => b.span.bbox[1] + b.span.bbox[3] - (a.span.bbox[1] + a.span.bbox[3]));
  if (boxed.length === 0) return { width: A4_WIDTH, height: A4_HEIGHT, placed: [], breaks: [] };
  const x0 = Math.max(0, Math.min(...boxed.map((l) => l.span.bbox[0])) - MARGIN);
  const x1 = Math.max(...boxed.map((l) => l.span.bbox[0] + Math.max(l.span.bbox[2], monoWidth(l.span)))) + MARGIN;
  const top = Math.min(A4_HEIGHT, boxed[0]!.span.bbox[1] + boxed[0]!.span.bbox[3] + MARGIN);

  let removed = 0;
  let lowest = Infinity;
  const breaks: number[] = [];
  const placed = boxed.map((l) => {
    const [x, y, , h] = l.span.bbox;
    const gap = lowest - (y + h);
    if (Number.isFinite(lowest) && gap > GAP_MAX) {
      breaks.push(top - lowest - removed + GAP_KEEP / 2);
      removed += gap - GAP_KEEP;
    }
    lowest = Math.min(lowest, y);
    return { ...l, left: x - x0, top: top - (y + h) - removed, fontSize: fontSizeOf(l.span) };
  });
  const bottom = Math.max(0, lowest - MARGIN);
  return { width: x1 - x0, height: top - bottom - removed, placed, breaks };
}

function LineText({ text, mark }: { text: string; mark: Mark | undefined }) {
  const value = mark?.value;
  if (!value) return <>{text}</>;
  const match = new RegExp(`(^|[^\\w.,])(${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?![\\w])`).exec(text);
  if (!match) return <>{text}</>;
  const start = match.index + match[1]!.length;
  return (
    <>
      {text.slice(0, start)}
      <strong className={styles.value}>{text.slice(start, start + value.length)}</strong>
      {text.slice(start + value.length)}
    </>
  );
}

function MarkTag({ mark }: { mark: Mark }) {
  return (
    <span className={styles.markTag} aria-label={mark.tone === "hit" ? "Mismatching value" : "Agreeing value"}>
      {mark.tone === "hit" ? "≠" : "="}
    </span>
  );
}

function Page({ page, lines, zoom }: { page: number; lines: PaperLine[]; zoom: number }) {
  if (lines.some((l) => l.span.bbox === null)) {
    return (
      <div className={`paper ${styles.flowPaper}`} aria-label={`Page ${page}`}>
        {lines.map((l) => (
          <div key={l.key} className={`paper-line ${styles.flowLine} ${l.mark?.tone ?? ""}`}>
            {l.mark ? <MarkTag mark={l.mark} /> : null}
            <LineText text={l.span.text} mark={l.mark} />
          </div>
        ))}
      </div>
    );
  }
  const r = layoutOf(lines);
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  return (
    <div className={styles.paperScroll}>
      <div className={`paper ${styles.paper}`} style={{ aspectRatio: `${r.width} / ${r.height}`, width: `${zoom * 100}%` }} aria-label={`Page ${page}`}>
        {r.breaks.map((b) => (
          <span key={b} className={styles.gapRule} style={{ top: pct(b, r.height) }} aria-hidden="true" />
        ))}
        {r.placed.map((l) => (
          <div key={l.key} className={`paper-line ${styles.line} ${l.mark?.tone ?? ""}`} style={{ left: pct(l.left, r.width), top: pct(l.top, r.height), fontSize: `${(l.fontSize / r.width) * 100}cqw` }}>
            {l.mark ? <MarkTag mark={l.mark} /> : null}
            <LineText text={l.span.text} mark={l.mark} />
          </div>
        ))}
        <span className={styles.folio}>p.{page}</span>
      </div>
    </div>
  );
}

function ModelFields({ fields, marks, model }: { fields: FieldView[]; marks: MarkedSpan[]; model: string | null }) {
  const toneOf = (f: FieldView) => marks.find((m) => spanKey(m.span) === spanKey(f.span))?.tone;
  return (
    <aside className={styles.modelFields} aria-label="Model-extracted values">
      <p className="small">
        <strong>Model-extracted, verify against source</strong>
      </p>
      <p className="tiny muted">
        Read by {model ?? "a model"} where rules found nothing. No page position, so check each quote.
      </p>
      <ul>
        {fields.map((f) => {
          const tone = toneOf(f);
          return (
            <li key={f.key} className={`${styles.modelField} ${tone ? styles[tone] : ""}`}>
              <span className="tiny muted mono">
                {tone ? <MarkTag mark={{ tone, value: f.value }} /> : null}
                {f.key.replaceAll("_", " ")} · {Math.round(f.confidence * 100)}%
              </span>
              <span className="mono small">{f.value}</span>
              <span className="tiny faint mono">
                p.{f.span.page}: “{f.span.text}”
              </span>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

export function PaperPane({ dealId, refItem, finding, zoom, side }: { dealId: string; refItem: VersionRef | null; finding: DiscrepancyView | null; zoom: number; side: "Left" | "Right" }) {
  const versionId = refItem?.version.id ?? null;
  const state = refItem?.version.analysisState ?? null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!versionId || state !== "done") return;
    let ignore = false;
    api<Analysis>(`/deals/${dealId}/documents/versions/${versionId}/analysis`).then(
      (analysis) => {
        if (!ignore) setLoaded({ versionId, analysis, error: null });
      },
      (e: unknown) => {
        if (!ignore) setLoaded({ versionId, analysis: null, error: errorMessage(e) });
      },
    );
    return () => {
      ignore = true;
    };
  }, [dealId, versionId, state]);

  if (!refItem || !versionId) {
    return (
      <section className={styles.pane} aria-label={`${side} document`}>
        <p className="empty">
          <strong>No document selected</strong>
          Upload two documents to compare.
        </p>
      </section>
    );
  }

  const v = refItem.version;
  const current = loaded?.versionId === versionId ? loaded : null;
  const marks = current?.analysis ? marksFor(finding, versionId, current.analysis) : [];
  const lines = current?.analysis ? withMarks(pageLines(current.analysis), marks) : [];
  const modelFields = current?.analysis?.fields.filter((f) => f.method === "model") ?? [];
  const pages = [...new Set(lines.map((l) => l.span.page))];
  const fileHref = `/api/v1/deals/${dealId}/documents/versions/${versionId}/file`;

  return (
    <section className={styles.pane} aria-label={`${side} document: ${versionLabel(refItem)}`}>
      <header className={styles.paneHead}>
        <div className="grow">
          <h3>{versionLabel(refItem)}</h3>
          <p className="tiny muted mono">
            {v.fileName} · sha256 {v.sha256.slice(0, 12)}… · {v.uploadedBy} · {fmtDateTime(v.uploadedAt)}
          </p>
        </div>
        <a className="btn sm" href={fileHref} target="_blank" rel="noreferrer">
          Open original
        </a>
      </header>
      {state !== "done" ? (
        <div className="empty" aria-live="polite">
          <AnalysisChip state={v.analysisState} />
          <p style={{ marginTop: 8 }}>{state === "failed" ? `Extraction failed: ${v.analysisError ?? "unknown error"}. The original is still stored.` : "Extracting. This pane fills in when done."}</p>
        </div>
      ) : current === null ? (
        <div className={styles.paperLoading} aria-live="polite">
          <div className="skeleton" style={{ width: "62%" }} />
          <div className="skeleton" style={{ width: "48%" }} />
          <div className="skeleton" style={{ width: "80%" }} />
          <span className="sr-only">Loading extracted text</span>
        </div>
      ) : current.error ? (
        <p className="small" role="alert" style={{ padding: 20, color: "var(--held-ink)" }}>
          Could not load the extraction: {current.error}
        </p>
      ) : lines.length === 0 && modelFields.length === 0 ? (
        <p className="empty">
          <strong>No text was extracted</strong>
          No text layer, likely a scan. Open the original.
          {v.analysisError ? <span className="tiny muted" style={{ display: "block", marginTop: 6 }}>{v.analysisError}</span> : null}
        </p>
      ) : (
        <div className={styles.pages}>
          {lines.length === 0 ? <p className="small muted">No text layer. Only model-read values below.</p> : null}
          {pages.map((p) => (
            <Page key={p} page={p} lines={lines.filter((l) => l.span.page === p)} zoom={zoom} />
          ))}
          {modelFields.length > 0 ? <ModelFields fields={modelFields} marks={marks} model={v.modelUsed} /> : null}
        </div>
      )}
    </section>
  );
}
