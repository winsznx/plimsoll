import type { Icon } from "@phosphor-icons/react";
import { Cube, Desktop, Gear, ListMagnifyingGlass } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Chip } from "@/components/chip";
import { Hash } from "@/components/hash";
import { AuditVerifyButton } from "@/components/workspace/audit-verify-button";
import { fmtDateTime } from "@/lib/format";
import type { ActivityItem } from "@/lib/views";
import { requireSession } from "@/server/auth/guard";
import { explorer } from "@/server/chain";
import { listDeals } from "@/server/services/deals";
import { activityFeed } from "@/server/services/workspace";
import styles from "./activity.module.css";

export const metadata: Metadata = { title: "Activity" };

const SOURCES = ["app", "chain", "system"] as const;
type Source = (typeof SOURCES)[number];

const SOURCE_LABEL: Record<Source, string> = { app: "App", chain: "Chain", system: "System" };
const SOURCE_ICON: Record<Source, Icon> = { app: Desktop, chain: Cube, system: Gear };

function isSource(v: string | undefined): v is Source {
  return SOURCES.some((s) => s === v);
}

function Evidence({ item }: { item: ActivityItem }) {
  const e = item.evidence;
  const parts: ReactNode[] = [];
  if (typeof e.version === "number") parts.push(<span key="v">v{e.version}</span>);
  if (typeof e.milestone === "number" && e.milestone >= 0) parts.push(<span key="m">M{e.milestone + 1}</span>);
  if (typeof e.ledger === "number") parts.push(<span key="l">ledger {e.ledger}</span>);
  if (typeof e.sha256 === "string") parts.push(<Hash key="sha" value={e.sha256} label="document SHA-256" />);
  if (typeof e.digest === "string") parts.push(<Hash key="dg" value={e.digest} label="evidence digest" />);
  if (typeof e.termsDigest === "string") parts.push(<Hash key="td" value={e.termsDigest} label="terms digest" />);
  if (typeof e.contractId === "string") parts.push(<Hash key="c" value={e.contractId} href={explorer("contract", e.contractId)} label="escrow contract" />);
  if (parts.length === 0) return <span className="faint">-</span>;
  return <div className={styles.evidence}>{parts}</div>;
}

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ deal?: string; source?: string }> }) {
  const { deal: dealFilter, source } = await searchParams;
  const session = await requireSession();
  const deals = await listDeals(session);
  const focus = dealFilter ? deals.find((d) => d.id === dealFilter) : null;
  if (dealFilter && !focus) notFound();
  const sourceFilter = isSource(source) ? source : null;

  const feed = await activityFeed(session, { dealId: focus?.id, limit: 200 });
  const shown = sourceFilter ? feed.filter((f) => f.source === sourceFilter) : feed;
  const filtered = Boolean(focus || sourceFilter);

  return (
    <>
      <div className="page-head">
        <div>
          {focus ? <p className="eyebrow">{focus.reference}</p> : null}
          <h1 style={focus ? { marginTop: 6 } : undefined}>Activity</h1>
          <div className="sub">
            <span>App entries are hash-chained. Chain entries are read from the ledger.</span>
          </div>
        </div>
        <AuditVerifyButton />
      </div>

      <section className="panel" aria-label="Audit trail">
        <form method="get" className={styles.toolbar} aria-label="Filter activity">
          <label htmlFor="a-deal" className="sr-only">
            Deal
          </label>
          <select id="a-deal" name="deal" className={`input ${styles.select}`} defaultValue={focus?.id ?? ""}>
            <option value="">All deals and account</option>
            {deals.map((d) => (
              <option key={d.id} value={d.id}>
                {d.reference} · {d.title}
              </option>
            ))}
          </select>
          <label htmlFor="a-source" className="sr-only">
            Source
          </label>
          <select id="a-source" name="source" className={`input ${styles.select}`} defaultValue={sourceFilter ?? ""}>
            <option value="">All sources</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABEL[s]}
              </option>
            ))}
          </select>
          <button type="submit" className="btn">
            Apply filters
          </button>
          {filtered ? (
            <Link className="btn ghost" href="/activity">
              Clear
            </Link>
          ) : null}
          <span className={styles.count}>
            {shown.length} of latest {feed.length}
          </span>
        </form>

        {shown.length === 0 ? (
          <p className={styles.empty}>
            <ListMagnifyingGlass aria-hidden />
            {filtered ? "No entries match." : "No activity yet."}{" "}
            {filtered ? (
              <Link className="ext" href="/activity">
                Clear filters
              </Link>
            ) : (
              <Link className="ext" href="/deals/new">
                Draft a deal
              </Link>
            )}
          </p>
        ) : (
          <div className="table-scroll">
            <table className={`table ${styles.table}`}>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Source</th>
                  {focus ? null : <th scope="col">Deal</th>}
                  <th scope="col">Who</th>
                  <th scope="col">What</th>
                  <th scope="col">Evidence</th>
                  <th scope="col">Transaction</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((f) => {
                  const SourceIcon = SOURCE_ICON[f.source];
                  return (
                    <tr key={f.id}>
                      <td className={styles.when}>
                        {fmtDateTime(f.at)}
                        <div>#{f.id}</div>
                      </td>
                      <td>
                        <span className={`${styles.source} ${f.source === "chain" ? styles.chain : ""}`}>
                          <SourceIcon aria-hidden />
                          {SOURCE_LABEL[f.source]}
                        </span>
                      </td>
                      {focus ? null : (
                        <td>
                          {f.dealReference ? (
                            <Link className={styles.ref} href={`/deals/${f.dealId}`}>
                              {f.dealReference}
                            </Link>
                          ) : (
                            <span className="faint tiny">Account</span>
                          )}
                        </td>
                      )}
                      <td className={styles.who}>{f.who}</td>
                      <td className={styles.what}>
                        {f.what.includes("rejected") ? <Chip tone="blocked">Rejected</Chip> : null} {f.what}
                      </td>
                      <td>
                        <Evidence item={f} />
                      </td>
                      <td className={styles.tx}>{f.txHash ? <Hash value={f.txHash} href={f.explorerUrl} label="transaction" /> : <span className="faint">-</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
