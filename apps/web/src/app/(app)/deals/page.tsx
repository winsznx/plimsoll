import { ArrowRight, DownloadSimple, MagnifyingGlass, Plus } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { Chip, DealStatusChip } from "@/components/chip";
import { Figure } from "@/components/instruments/figure";
import { fmtDate, STATUS_LABEL } from "@/lib/format";
import { requireSession } from "@/server/auth/guard";
import { isChainConfigured, network } from "@/server/chain";
import { chainConfig } from "@/server/env";
import { dealIndex, parseDealIndexFilter, type DealIndexFilter } from "@/server/services/deal-index";
import { EscrowBar, EscrowLegend } from "@/components/instruments/escrow-bar";
import styles from "./deals.module.css";

export const metadata: Metadata = { title: "Deals" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const SAVED_VIEWS: { label: string; params: Partial<Record<"view" | "status", string>> }[] = [
  { label: "All deals", params: {} },
  { label: "Needs my action", params: { view: "action" } },
  { label: "Funded", params: { status: "funded" } },
  { label: "Drafts", params: { status: "draft" } },
];

function query(filter: DealIndexFilter, override: Partial<Record<"q" | "status" | "view" | "sort", string | null>> = {}): string {
  const merged: Record<string, string | null> = { q: filter.q || null, status: filter.status, view: filter.view, sort: filter.sort === "updated" ? null : filter.sort, ...override };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
  const s = params.toString();
  return s ? `?${s}` : "";
}

export default async function DealsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const filter = parseDealIndexFilter((k) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  });
  const session = await requireSession();
  const { rows, visible } = await dealIndex(session, filter);
  const net = network();
  const isDemo = isChainConfigured() && chainConfig().asset.isDemo;
  const codes = [...new Set(rows.map((r) => r.assetCode))];
  const filtered = Boolean(filter.q || filter.status || filter.view);
  const viewIsCurrent = (params: Partial<Record<"view" | "status", string>>) => !filter.q && (params.view ?? null) === filter.view && (params.status ?? null) === filter.status;
  const sortLink = (key: DealIndexFilter["sort"], label: string) => (
    <Link className={styles.sortLink} href={`/deals${query(filter, { sort: key === "updated" ? null : key })}`} aria-current={filter.sort === key ? "true" : undefined}>
      {label}
    </Link>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Deals</h1>
          <div className="sub">
            <span>
              {visible} agreement{visible === 1 ? "" : "s"} · {net.label}
            </span>
          </div>
        </div>
        <div className="btn-group">
          <a className="btn" href={`/api/v1/deals/export.csv${query(filter)}`} download>
            <DownloadSimple aria-hidden />
            Export CSV
          </a>
          <Link className="btn primary" href="/deals/new">
            <Plus aria-hidden />
            New deal
          </Link>
        </div>
      </div>

      <section className="panel" aria-label="Deals">
        <div className={styles.bar}>
          <nav className={styles.views} aria-label="Saved views">
            {SAVED_VIEWS.map((v) => (
              <Link key={v.label} href={`/deals${query({ q: "", status: null, view: null, sort: filter.sort }, v.params)}`} aria-current={viewIsCurrent(v.params) ? "page" : undefined}>
                {v.label}
              </Link>
            ))}
          </nav>
          <form className={styles.toolbar} method="get" action="/deals" role="search">
            <div className={styles.search}>
              <label htmlFor="deals-q" className="sr-only">
                Search
              </label>
              <MagnifyingGlass aria-hidden />
              <input id="deals-q" className="input" type="search" name="q" defaultValue={filter.q} placeholder="Reference, title, cargo, party, port" />
            </div>
            <label htmlFor="deals-status" className="sr-only">
              Status
            </label>
            <select id="deals-status" className={`input ${styles.status}`} name="status" defaultValue={filter.status ?? ""}>
              <option value="">Any status</option>
              {Object.entries(STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {filter.view ? <input type="hidden" name="view" value={filter.view} /> : null}
            {filter.sort !== "updated" ? <input type="hidden" name="sort" value={filter.sort} /> : null}
            <button type="submit" className="btn">
              Apply
            </button>
            {filtered ? (
              <Link className="btn ghost" href="/deals">
                Clear
              </Link>
            ) : null}
          </form>
        </div>
        <div className={styles.meta}>
          <span aria-live="polite">
            Showing {rows.length} of {visible}
            {filter.view ? " · needs your action" : ""}
          </span>
          <nav className={styles.sort} aria-label="Sort deals">
            Sort
            {sortLink("updated", "Updated")}
            {sortLink("value", "Value")}
            {sortLink("reference", "Reference")}
          </nav>
          {rows.length > 0 ? <EscrowLegend /> : null}
        </div>

        <div className="panel-body flush table-scroll">
          {visible === 0 ? (
            <p className={styles.empty}>
              No agreements yet.{" "}
              <Link className="ext" href="/deals/new">
                Draft the first one
              </Link>
            </p>
          ) : rows.length === 0 ? (
            <p className={styles.empty}>
              {filter.view ? "Nothing is waiting on you." : "No deals match."}{" "}
              <Link className="ext" href="/deals">
                Show all deals
              </Link>
            </p>
          ) : (
            <table className={`table ${styles.table}`}>
              <thead>
                <tr>
                  <th scope="col">Deal</th>
                  <th scope="col">Agreement</th>
                  <th scope="col">Counterparty</th>
                  <th scope="col" className={styles.barCol}>
                    Escrow
                  </th>
                  <th scope="col" className="num">
                    Value
                  </th>
                  <th scope="col">Next</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link className={styles.ref} href={`/deals/${r.id}`}>
                        {r.reference}
                      </Link>
                      <div className={styles.tag}>
                        {fmtDate(r.updatedAt)}
                        {r.isSample ? " · Sample" : ""}
                      </div>
                    </td>
                    <td>
                      <div className={styles.title}>{r.title}</div>
                      <div className={styles.line}>
                        {r.originPort} <ArrowRight aria-label="to" /> {r.destinationPort} · {r.incoterm}
                      </div>
                    </td>
                    <td>
                      <div className={styles.party}>{r.counterparty}</div>
                      <div className={styles.line}>You: {r.myRoles.join(", ") || "viewer"}</div>
                    </td>
                    <td className={styles.barCol}>
                      <EscrowBar total={r.totalUnits} funded={r.fundedUnits} escrow={r.escrowUnits} />
                      <div className={styles.line}>
                        {r.syncStatus === "unavailable" ? (
                          <span className={styles.stale}>RPC unreadable</span>
                        ) : r.fundedUnits === null ? (
                          "Not deployed"
                        ) : (
                          <>
                            <Figure units={r.escrowUnits ?? "0"} size="sm" /> held
                          </>
                        )}
                      </div>
                    </td>
                    <td className="num">
                      <Figure units={r.totalUnits} size="sm" />
                      {codes.length > 1 ? <div className={styles.line}>{r.assetCode}</div> : null}
                    </td>
                    <td>
                      {r.myAction ? <div className={styles.mine}>{r.myAction}</div> : null}
                      <div className={r.myAction ? styles.line : styles.next}>{r.nextCondition}</div>
                    </td>
                    <td>
                      <div className={styles.chips}>
                        <DealStatusChip status={r.status} />
                        {r.blockingFindings > 0 ? (
                          <Link href={`/deals/${r.id}/documents`} aria-label={`${r.reference}: ${r.blockingFindings} blocking mismatch${r.blockingFindings === 1 ? "" : "es"}`}>
                            <Chip tone="blocked">{r.blockingFindings} blocking</Chip>
                          </Link>
                        ) : null}
                        {r.openDisputes > 0 ? (
                          <Link href={`/deals/${r.id}`} aria-label={`${r.reference}: ${r.openDisputes} open dispute${r.openDisputes === 1 ? "" : "s"}`}>
                            <Chip tone="disputed">
                              {r.openDisputes} dispute{r.openDisputes === 1 ? "" : "s"}
                            </Chip>
                          </Link>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {rows.length > 0 ? (
          <p className={styles.caption}>
            {codes.join(", ")} on {net.label}
            {isDemo ? ", demo token, not USDC" : ""}. Escrow figures are read from each contract.
          </p>
        ) : null}
      </section>
    </>
  );
}
