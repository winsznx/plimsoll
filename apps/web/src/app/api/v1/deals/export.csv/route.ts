import { formatAmount } from "@plimsoll/domain";
import { network } from "@/server/chain";
import { route } from "@/server/http";
import { dealIndex, parseDealIndexFilter } from "@/server/services/deal-index";

const COLUMNS = [
  "reference",
  "title",
  "status",
  "buyer",
  "supplier",
  "origin",
  "destination",
  "incoterm",
  "asset",
  "network",
  "agreement_total",
  "funded",
  "held_in_escrow",
  "chain_read",
  "next_condition",
  "blocking_findings",
  "open_disputes",
  "updated_at",
] as const;

function cell(value: string | number): string {
  const s = String(value);
  // Leading formula characters are neutralised so spreadsheets never evaluate deal text.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function decimal(units: string | null): string {
  return units === null ? "" : formatAmount(BigInt(units), { grouping: false });
}

/** The deals index as CSV, honouring the same q / status / view / sort parameters as /deals. */
export const GET = route(async ({ req, session }) => {
  const params = req.nextUrl.searchParams;
  const { rows } = await dealIndex(session, parseDealIndexFilter((k) => params.get(k) ?? undefined));
  const net = network().id;
  const lines = [
    COLUMNS.join(","),
    ...rows.map((r) =>
      [
        r.reference,
        r.title,
        r.status,
        r.buyer,
        r.supplier,
        r.originPort,
        r.destinationPort,
        r.incoterm,
        r.assetCode,
        net,
        decimal(r.totalUnits),
        decimal(r.fundedUnits),
        decimal(r.escrowUnits),
        r.fundedUnits === null ? "not deployed or not yet read" : r.syncStatus === "unavailable" ? "status unavailable (RPC)" : "chain readback",
        r.nextCondition,
        r.blockingFindings,
        r.openDisputes,
        r.updatedAt,
      ]
        .map(cell)
        .join(","),
    ),
  ];
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(`${lines.join("\r\n")}\r\n`, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="plimsoll-deals-${stamp}.csv"`, "cache-control": "no-store" },
  });
});
