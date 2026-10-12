import { DOCUMENT_TYPE_LABELS, type DocumentType } from "@plimsoll/domain";
import type { DiscrepancyView } from "@/lib/views";
import { Chip, type ChipTone } from "../chip";

export function documentTypeLabel(type: string): string {
  return DOCUMENT_TYPE_LABELS[type as DocumentType] ?? type.replaceAll("_", " ");
}

const ANALYSIS: Record<string, [ChipTone, string]> = {
  queued: ["awaiting", "Queued"],
  processing: ["awaiting", "Analysing"],
  done: ["confirmed", "Analysed"],
  failed: ["blocked", "Analysis failed"],
};

export function AnalysisChip({ state }: { state: string }) {
  const [tone, label] = ANALYSIS[state] ?? ["neutral", state];
  return <Chip tone={tone}>{label}</Chip>;
}

const SEVERITY: Record<DiscrepancyView["severity"], [ChipTone, string]> = {
  blocking: ["blocked", "Blocking"],
  warning: ["attention", "Warning"],
  info: ["neutral", "Info"],
};

export function SeverityChip({ severity }: { severity: DiscrepancyView["severity"] }) {
  const [tone, label] = SEVERITY[severity];
  return <Chip tone={tone}>{label}</Chip>;
}

const FINDING_STATE: Record<string, [ChipTone, string]> = {
  open: ["awaiting", "Open"],
  correction_requested: ["awaiting", "Correction requested"],
  accepted_as_is: ["confirmed", "Accepted as-is"],
  non_material: ["confirmed", "Declared non-material"],
  resolved: ["confirmed", "Resolved"],
};

export function FindingStateChip({ finding }: { finding: Pick<DiscrepancyView, "state" | "active"> }) {
  if (!finding.active && finding.state === "resolved") return <Chip tone="confirmed">No longer reproduced</Chip>;
  const [tone, label] = FINDING_STATE[finding.state] ?? ["neutral", finding.state.replaceAll("_", " ")];
  return <Chip tone={tone}>{label}</Chip>;
}

export function isAnalysing(state: string): boolean {
  return state === "queued" || state === "processing";
}
