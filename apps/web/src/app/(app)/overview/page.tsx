import type { Icon } from "@phosphor-icons/react";
import { ArrowRight, Clock, PenNib, Plus, Scales, WarningOctagon } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { DealStatusChip } from "@/components/chip";
import { Hash } from "@/components/hash";
import { AccountPath } from "@/components/instruments/account-path";
import { Figure } from "@/components/instruments/figure";
import { fmtDateTime } from "@/lib/format";
import { requireSession } from "@/server/auth/guard";
import { isChainConfigured, network } from "@/server/chain";
import { chainConfig } from "@/server/env";
import { dealIndex, type DealIndexRow } from "@/server/services/deal-index";
import { overview } from "@/server/services/workspace";
import { EscrowBar, EscrowLegend } from "@/components/instruments/escrow-bar";
import styles from "./overview.module.css";

export const metadata: Metadata = { title: "Overview" };

const LIVE = new Set(["awaiting_acceptance", "awaiting_funding", "funded"]);

const MOVE: Record<string, { from: string; to: string; held?: boolean }> = {
  fund: { from: "Buyer", to: "Escrow", held: true },
  release: { from: "Escrow", to: "Payee" },
  resolve: { from: "Escrow", to: "Split" },
  refund: { from: "Escrow", to: "Buyer" },
};

interface QueueItem {
  key: string;
  reference: string;
  href: string;
  what: string;
  stake: { units: string; label: string } | null;
}

interface QueueGroup {
  label: string;
  icon: Icon;
  hot: boolean;
  items: QueueItem[];
}

function stakeOf(row: DealIndexRow | undefined): QueueItem["stake"] {
  if (!row) return null;
  if (row.escrowUnits !== null && BigInt(row.escrowUnits) > 0n) return { units: row.escrowUnits, label: "in escrow" };
  return { units: row.totalUnits, label: "agreement" };
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export default async function OverviewPage() {
  const session = await requireSession();
  const ov = await overview(session);
  const index = await dealIndex(session, { q: "", status: null, view: null, sort: "updated" });
  const net = network();
  const isDemo = isChainConfigured() && chainConfig().asset.isDemo;
  const hasWallet = session.wallets.some((w) => w.network === net.id);
  const byId = new Map(index.rows.map((r) => [r.id, r]));
  const assetLine = `${net.label}${isDemo ? " · demo token, not USDC" : ""}`;

  const mismatchTotal = ov.documentMismatches.reduce((a, m) => a + m.count, 0);
  const outOfEscrow = index.rows.reduce((a, r) => (r.fundedUnits !== null && r.escrowUnits !== null ? a + BigInt(r.fundedUnits) - BigInt(r.escrowUnits) : a), 0n);

  const signRows = index.rows.filter((r) => r.myAction !== null && !r.myAction.startsWith("Resolve"));
  const signItems: QueueItem[] = signRows.map((r) => ({
    key: `sign-${r.id}`,
    reference: r.reference,
    href: `/deals/${r.id}`,
    what: r.myAction ?? "",
    stake: r.myAction === "Fund escrow" ? { units: String(BigInt(r.totalUnits) - BigInt(r.fundedUnits ?? "0")), label: "to fund" } : stakeOf(r),
  }));
  for (const a of ov.approvalsWaiting) {
    if (signItems.some((s) => s.href === `/deals/${a.dealId}` && s.what === `Approve ${a.milestone}`)) continue;
    signItems.push({ key: `approve-${a.dealId}-${a.milestone}`, reference: a.reference, href: `/deals/${a.dealId}`, what: `Approve ${a.milestone}`, stake: stakeOf(byId.get(a.dealId)) });
  }
  const signDeals = new Set(signItems.map((s) => s.href)).size;

  const groups: QueueGroup[] = [
    { label: "Awaiting your signature", icon: PenNib, hot: false, items: signItems },
    {
      label: "Blocking document mismatches",
      icon: WarningOctagon,
      hot: true,
      items: ov.documentMismatches.map((m) => ({ key: `mm-${m.dealId}`, reference: m.reference, href: `/deals/${m.dealId}/documents`, what: plural(m.count, "blocking mismatch", "blocking mismatches"), stake: stakeOf(byId.get(m.dealId)) })),
    },
    {
      label: "Open disputes",
      icon: Scales,
      hot: true,
      items: ov.disputesOpen.map((d) => ({
        key: `dp-${d.dealId}-${d.milestone}`,
        reference: d.reference,
        href: `/deals/${d.dealId}/disputes/${d.milestone}`,
        what: byId.get(d.dealId)?.myAction?.startsWith("Resolve dispute") ? `Decide milestone ${d.milestone + 1}` : `Milestone ${d.milestone + 1} frozen`,
        stake: stakeOf(byId.get(d.dealId)),
      })),
    },
    {
      label: "Deadlines nearing",
      icon: Clock,
      hot: false,
      items: ov.shipmentsNearingDeadline.map((s) => ({ key: `dl-${s.dealId}-${s.detail}`, reference: s.reference, href: `/deals/${s.dealId}`, what: s.detail, stake: stakeOf(byId.get(s.dealId)) })),
    },
  ].filter((g) => g.items.length > 0);
  const queued = groups.reduce((n, g) => n + g.items.length, 0);

  const live = index.rows.filter((r) => LIVE.has(r.status));
  const drafts = index.rows.filter((r) => r.status === "draft").length;
  const closed = index.visible - live.length - drafts;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">{session.org?.displayName ?? session.user.displayName}</p>
          <h1 className={styles.title}>Global trade overview</h1>
        </div>
        <div className="btn-group">
          <Link className="btn" href="/deals">
            All deals
          </Link>
          <Link className="btn primary" href="/deals/new">
            <Plus aria-hidden />
            New deal
          </Link>
        </div>
      </div>

      {ov.unsyncedDeals > 0 ? (
        <div className={styles.alert} role="status">
          <WarningOctagon weight="fill" aria-hidden />
          RPC unreadable for {plural(ov.unsyncedDeals, "deal", "deals")}. Figures use the last good ledger read.
        </div>
      ) : null}

      {index.visible === 0 ? (
        <section className="panel" aria-labelledby="start">
          <div className="panel-head">
            <div>
              <h2 id="start" style={{ fontSize: 15 }}>
                No trades yet
              </h2>
              <p className="sub">Nothing is held in escrow for {session.org?.legalName ?? "your organization"}.</p>
            </div>
          </div>
          <div className="panel-body">
            <ol className="rail-steps" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              <li className={`rail-step ${hasWallet ? "done" : "current"}`}>
                <strong>Connect a signing wallet on {net.label}</strong>
                <small>
                  {hasWallet ? (
                    "Done"
                  ) : (
                    <>
                      Needed to create a deal ·{" "}
                      <Link className="ext" href="/settings">
                        Open settings
                      </Link>
                    </>
                  )}
                </small>
              </li>
              <li className={`rail-step ${hasWallet ? "current" : ""}`}>
                <strong>Draft the agreement</strong>
                <small>Parties, goods, milestones, documents. Private until frozen.</small>
              </li>
              <li className="rail-step">
                <strong>Freeze terms and deploy the escrow</strong>
                <small>Both parties accept on-chain before funding.</small>
              </li>
            </ol>
            <div className="btn-group" style={{ marginTop: 20 }}>
              {hasWallet ? (
                <Link className="btn primary" href="/deals/new">
                  Create a deal
                </Link>
              ) : (
                <>
                  <Link className="btn primary" href="/settings">
                    Connect a wallet
                  </Link>
                  <Link className="btn" href="/deals/new">
                    Start a draft anyway
                  </Link>
                </>
              )}
            </div>
          </div>
        </section>
      ) : (
        <>
          <section className={styles.board} aria-label="Exposure and actions">
            <dl className={styles.strip}>
              <div>
                <dt>Held in escrow</dt>
                <dd>
                  <Figure units={ov.fundsAtWork} code={ov.assetCode} size="lg" />
                </dd>
                <dd className={styles.cap}>{assetLine}</dd>
              </div>
              <div>
                <dt>Out of escrow</dt>
                <dd>
                  <Figure units={outOfEscrow} size="lg" />
                </dd>
                <dd className={styles.cap}>Released + refunded, all deals</dd>
              </div>
              <div className={mismatchTotal > 0 ? styles.hot : undefined}>
                <dt>Blocking mismatches</dt>
                <dd className={styles.count}>{mismatchTotal}</dd>
                <dd className={styles.cap}>{mismatchTotal > 0 ? `On ${plural(ov.documentMismatches.length, "deal", "deals")}` : "Documents reconcile"}</dd>
              </div>
              <div>
                <dt>Awaiting your signature</dt>
                <dd className={styles.count}>{signDeals}</dd>
                <dd className={styles.cap}>{signDeals === 1 ? "Deal" : "Deals"}</dd>
              </div>
            </dl>

            <div className={styles.split}>
              <div className="panel">
                <div className="panel-head">
                  <h2 className={styles.h2}>Needs you</h2>
                  <span className={styles.meta}>{queued}</span>
                </div>
                {queued === 0 ? (
                  <p className={styles.empty}>
                    Nothing is waiting on you.{" "}
                    <Link className="ext" href="/deals">
                      Open deals
                    </Link>
                  </p>
                ) : (
                  groups.map((g) => (
                    <section key={g.label} className={`${styles.group} ${g.hot ? styles.hotGroup : ""}`} aria-label={g.label}>
                      <h3 className={styles.groupHead}>
                        <g.icon weight={g.hot ? "fill" : "regular"} aria-hidden />
                        {g.label}
                        <span>{g.items.length}</span>
                      </h3>
                      <ul className={styles.queue}>
                        {g.items.map((item) => (
                          <li key={item.key}>
                            <Link href={item.href}>
                              <span className={styles.ref}>{item.reference}</span>
                              <span className={styles.what}>{item.what}</span>
                              {item.stake ? (
                                <span className={styles.stake}>
                                  <Figure units={item.stake.units} size="sm" />
                                  <small>{item.stake.label}</small>
                                </span>
                              ) : (
                                <span />
                              )}
                              <ArrowRight className={styles.go} aria-hidden />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))
                )}
              </div>

              <div className="panel">
                <div className="panel-head">
                  <h2 className={styles.h2}>Money moved</h2>
                  <Link className="ext tiny" href="/settlements">
                    Settlements
                  </Link>
                </div>
                {ov.recentSettlements.length === 0 ? (
                  <p className={styles.empty}>Nothing has moved on {net.label} yet.</p>
                ) : (
                  <ul className={styles.moves}>
                    {ov.recentSettlements.map((s, i) => {
                      const move = MOVE[s.kind];
                      return (
                        <li key={`${s.txHash ?? s.at}-${i}`}>
                          {move ? <AccountPath {...move} /> : <span className="mono tiny">{s.kind}</span>}
                          {s.amount === null ? <span className="faint">-</span> : <Figure units={s.amount} size="sm" />}
                          <small>
                            <Link className="ext" href={`/deals/${s.dealId}/settlement`}>
                              {s.reference}
                            </Link>
                            <span>{fmtDateTime(s.at)}</span>
                            {s.txHash ? <Hash value={s.txHash} href={s.explorerUrl} label="settlement transaction" /> : null}
                          </small>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </section>

          <section className="panel" aria-labelledby="live-deals">
            <div className="panel-head">
              <div className={styles.headLine}>
                <h2 id="live-deals" className={styles.h2}>
                  Live deals
                </h2>
                <span className={styles.meta}>{live.length}</span>
              </div>
              <EscrowLegend />
            </div>
            {live.length === 0 ? (
              <p className={styles.empty}>
                No deal is live.{" "}
                <Link className="ext" href="/deals">
                  Open deals
                </Link>
              </p>
            ) : (
              <div className="table-scroll">
                <table className={`table ${styles.table}`}>
                  <thead>
                    <tr>
                      <th scope="col">Deal</th>
                      <th scope="col">Counterparty</th>
                      <th scope="col" className={styles.barCol}>
                        Position
                      </th>
                      <th scope="col" className="num">
                        In escrow
                      </th>
                      <th scope="col" className="num">
                        Total
                      </th>
                      <th scope="col">Next</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {live.map((d) => (
                      <tr key={d.id}>
                        <td>
                          <Link className={styles.ref} href={`/deals/${d.id}`}>
                            {d.reference}
                          </Link>
                          <div className={styles.sub}>{d.title}</div>
                        </td>
                        <td className={styles.clip}>{d.counterparty}</td>
                        <td className={styles.barCol}>
                          <EscrowBar total={d.totalUnits} funded={d.fundedUnits} escrow={d.escrowUnits} />
                        </td>
                        <td className="num">{d.escrowUnits === null ? <span className="faint">-</span> : <Figure units={d.escrowUnits} size="sm" />}</td>
                        <td className="num">
                          <Figure units={d.totalUnits} size="sm" />
                        </td>
                        <td>
                          <div className={styles.next}>{d.nextCondition}</div>
                          {d.myAction ? <div className={styles.mine}>You: {d.myAction}</div> : null}
                        </td>
                        <td>
                          <DealStatusChip status={d.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className={styles.foot}>
              <span>
                {plural(drafts, "draft", "drafts")} · {closed} settled or cancelled
              </span>
              <Link className="ext" href="/deals">
                All {index.visible} deals
              </Link>
            </p>
          </section>
        </>
      )}
    </>
  );
}
