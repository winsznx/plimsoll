import { CheckCircle, Circle, Prohibit, WarningDiamond, Minus } from "@phosphor-icons/react/ssr";
import type { ReactNode } from "react";

export type ChipTone = "confirmed" | "awaiting" | "attention" | "blocked" | "disputed" | "neutral";

const GLYPHS: Record<ChipTone, ReactNode> = {
  confirmed: <CheckCircle weight="fill" aria-hidden />,
  awaiting: <Circle weight="bold" aria-hidden />,
  attention: <Circle weight="fill" aria-hidden />,
  blocked: <Prohibit weight="bold" aria-hidden />,
  disputed: <WarningDiamond weight="fill" aria-hidden />,
  neutral: <Minus weight="bold" aria-hidden />,
};

/** Status is a glyph plus a word; colour only reinforces it. */
export function Chip({ tone, children }: { tone: ChipTone; children: ReactNode }) {
  return (
    <span className={`chip ${tone === "neutral" ? "" : tone}`}>
      {GLYPHS[tone]}
      {children}
    </span>
  );
}

const DEAL_TONES: Record<string, [ChipTone, string]> = {
  draft: ["neutral", "Draft"],
  awaiting_acceptance: ["awaiting", "To sign"],
  awaiting_funding: ["awaiting", "To fund"],
  funded: ["attention", "Funded"],
  completed: ["confirmed", "Settled"],
  cancelled: ["neutral", "Cancelled"],
};

export function DealStatusChip({ status }: { status: string }) {
  const [tone, label] = DEAL_TONES[status] ?? ["neutral", status.replaceAll("_", " ")];
  return <Chip tone={tone}>{label}</Chip>;
}

const MILESTONE_TONES: Record<string, [ChipTone, string]> = {
  released: ["confirmed", "Released"],
  resolved: ["confirmed", "Resolved"],
  refunded: ["neutral", "Refunded"],
  eligible: ["attention", "Ready to release"],
  pending_authorizations: ["awaiting", "Awaiting approvals"],
  under_review: ["awaiting", "In review"],
  waiting_evidence: ["awaiting", "Awaiting evidence"],
  blocked: ["blocked", "Held"],
  disputed: ["disputed", "Disputed"],
};

export function MilestonePhaseChip({ phase }: { phase: string }) {
  const [tone, label] = MILESTONE_TONES[phase] ?? ["neutral", phase.replaceAll("_", " ")];
  return <Chip tone={tone}>{label}</Chip>;
}
