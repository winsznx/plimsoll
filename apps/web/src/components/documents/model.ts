import type { FindingSide, SourceSpan } from "@plimsoll/domain";
import type { DiscrepancyView, DocumentVersionView, DocumentView, FieldView, LineItemView, MilestoneView } from "@/lib/views";
import { documentTypeLabel } from "./status";

export interface Analysis {
  fields: FieldView[];
  lineItems: LineItemView[];
  /** Every positioned line of the original, in the same coordinate space as spans. */
  lines: SourceSpan[];
}

export interface VersionRef {
  doc: DocumentView;
  version: DocumentVersionView;
  latest: boolean;
}

export function indexVersions(docs: DocumentView[]): Map<string, VersionRef> {
  const index = new Map<string, VersionRef>();
  for (const doc of docs) doc.versions.forEach((version, i) => index.set(version.id, { doc, version, latest: i === 0 }));
  return index;
}

export function versionLabel(ref: VersionRef): string {
  return `${documentTypeLabel(ref.doc.documentType)} v${ref.version.version}${ref.latest ? "" : " (superseded)"}`;
}

export function sideLabel(side: FindingSide, index: Map<string, VersionRef>, termsVersion: number): string {
  if (side.documentType === "agreement") return `Agreement terms v${termsVersion}`;
  const ref = side.versionId ? index.get(side.versionId) : undefined;
  return ref ? versionLabel(ref) : documentTypeLabel(side.documentType);
}

/** Commercial invoice against packing list when both exist, otherwise the first two documents. */
export function defaultPair(docs: DocumentView[]): [string | null, string | null] {
  const latest = (type: string) => docs.find((d) => d.documentType === type)?.versions[0]?.id ?? null;
  const invoice = latest("commercial_invoice");
  const packing = latest("packing_list");
  if (invoice && packing) return [invoice, packing];
  const ids = docs.map((d) => d.versions[0]?.id).filter((x): x is string => Boolean(x));
  const left = invoice ?? packing ?? ids[0] ?? null;
  return [left, ids.find((x) => x !== left) ?? null];
}

export function spanKey(span: SourceSpan): string {
  return `${span.page}|${span.bbox?.map((n) => n.toFixed(1)).join(",") ?? "flow"}|${span.text}`;
}

export type Mark = { tone: "hit" | "ok"; value: string | null };

export interface MarkedSpan extends Mark {
  span: SourceSpan;
}

const normalize = (v: string | null | undefined): string => (v ?? "").replace(/[\s,]+/g, " ").trim().toLowerCase();

/**
 * Which spans of one document version a finding points at. The mismatching value is a hit; the
 * value it was checked against is ok. When the reference side is the agreement itself, the
 * matching line in the other document (same SKU or field key) shows whether it agrees.
 */
export function marksFor(finding: DiscrepancyView | null, versionId: string, analysis: Analysis): MarkedSpan[] {
  if (!finding) return [];
  const { expected, actual } = finding;
  const marks: MarkedSpan[] = [];
  if (actual.versionId === versionId && actual.span) marks.push({ span: actual.span, tone: "hit", value: actual.value });
  if (expected.versionId === versionId && expected.span) marks.push({ span: expected.span, tone: "ok", value: expected.value });
  if (actual.versionId === versionId || expected.versionId === versionId) return marks;

  const [prefix, subject] = finding.field.split(":", 2);
  if ((prefix === "qty" || prefix === "line") && subject) {
    const line = analysis.lineItems.find((l) => l.sku.toUpperCase() === subject.toUpperCase());
    if (line) {
      const value = String(line.quantity);
      marks.push({ span: line.span, tone: prefix === "qty" && value === expected.value ? "ok" : "hit", value });
    }
    return marks;
  }
  const field = analysis.fields.find((f) => f.key === prefix);
  if (field) marks.push({ span: field.span, tone: normalize(field.value) === normalize(expected.value) ? "ok" : "hit", value: field.value });
  return marks;
}

const SAME_ROW_PT = 2;

/** Finds the page line a span came from: same page and baseline within 2pt, or same text for unpositioned documents. */
export function lineIndexFor(lines: SourceSpan[], span: SourceSpan): number {
  let best = -1;
  let bestDy = Infinity;
  lines.forEach((l, i) => {
    if (l.page !== span.page) return;
    if (l.bbox && span.bbox) {
      const dy = Math.abs(l.bbox[1] - span.bbox[1]);
      if (dy <= SAME_ROW_PT && dy < bestDy) {
        best = i;
        bestDy = dy;
      }
    } else if (best === -1 && normalize(l.text) === normalize(span.text)) {
      best = i;
    }
  });
  return best;
}

export const ACTIVE_STATES = new Set(["open", "correction_requested"]);

const SEVERITY_ORDER: Record<DiscrepancyView["severity"], number> = { blocking: 0, warning: 1, info: 2 };

export function sortFindings(findings: DiscrepancyView[]): DiscrepancyView[] {
  const rank = (f: DiscrepancyView) => (f.active && ACTIVE_STATES.has(f.state) ? 0 : f.active ? 1 : 2);
  return [...findings].sort((a, b) => rank(a) - rank(b) || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

const SETTLED = new Set(["Released", "Resolved", "Refunded"]);

/**
 * Milestones an open blocking finding keeps from releasing. The gate holds every unsettled
 * milestone that needs documents; the ones requiring the finding's own document types come first.
 */
export function heldBy(finding: DiscrepancyView, milestones: MilestoneView[]): MilestoneView[] {
  if (finding.severity !== "blocking" || !finding.active || !ACTIVE_STATES.has(finding.state)) return [];
  const held = milestones.filter((m) => m.openBlockingFindings > 0 && !(m.chainStatus !== null && SETTLED.has(m.chainStatus)));
  const types: string[] = [finding.actual.documentType, finding.expected.documentType];
  const direct = held.filter((m) => m.requiredDocuments.some((t) => types.includes(t)));
  return direct.length > 0 ? direct : held;
}
