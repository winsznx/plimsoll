import { parseAmount } from "@plimsoll/domain";

/** The illustrative deal drawn on the landing page. Mirrors the seeded PL-2048 split; no chain data. */
export const SAMPLE_CODE = "DEMOUSD";

export const SAMPLE_MILESTONES = [
  { ordinal: 0, name: "Purchase confirmed", share: 20, amount: parseAmount("29720"), condition: "Buyer confirms the order.", approvers: "Buyer" },
  { ordinal: 1, name: "Carrier handoff", share: 60, amount: parseAmount("89160"), condition: "Invoice, packing list and B/L reconcile.", approvers: "Buyer, Inspector" },
  { ordinal: 2, name: "Receipt acknowledged", share: 20, amount: parseAmount("29720"), condition: "Buyer confirms receipt within 45 days.", approvers: "Buyer" },
] as const;

export const SAMPLE_TOTAL = SAMPLE_MILESTONES.reduce((sum, m) => sum + m.amount, 0n);
