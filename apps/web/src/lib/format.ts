import { formatAmount } from "@plimsoll/domain";

export function units(value: string | bigint | null | undefined, code?: string): string {
  if (value === null || value === undefined) return "-";
  const s = formatAmount(BigInt(value));
  return code ? `${s} ${code}` : s;
}

export function shortAddress(address: string | null | undefined, head = 4, tail = 4): string {
  if (!address) return "-";
  return address.length <= head + tail + 1 ? address : `${address.slice(0, head)}…${address.slice(-tail)}`;
}

export function shortHash(hash: string | null | undefined): string {
  return hash ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : "-";
}

const DATE = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const DATETIME = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC", hour12: false });

export function fmtDate(iso: string | number | Date | null | undefined): string {
  if (iso === null || iso === undefined) return "-";
  return DATE.format(new Date(iso));
}

export function fmtDateTime(iso: string | number | Date | null | undefined): string {
  if (iso === null || iso === undefined) return "-";
  return `${DATETIME.format(new Date(iso))} UTC`;
}

export function percentOf(part: string | bigint, total: string | bigint): number {
  const t = BigInt(total);
  if (t === 0n) return 0;
  return Number((BigInt(part) * 10_000n) / t) / 100;
}

export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  awaiting_acceptance: "Awaiting acceptance",
  awaiting_funding: "Awaiting funding",
  funded: "Funded",
  completed: "Completed",
  cancelled: "Cancelled",
};
