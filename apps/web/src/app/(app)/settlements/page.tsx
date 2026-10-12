import { SealCheck, SealWarning } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { Chip, DealStatusChip } from "@/components/chip";
import { Hash } from "@/components/hash";
import { AccountPath } from "@/components/instruments/account-path";
import { Figure } from "@/components/instruments/figure";
import { TrancheRail } from "@/components/instruments/tranche-rail";
import { tranchesOf } from "@/components/instruments/tranche";
import { dealViews } from "@/components/workspace/deal-views";
import { fmtDateTime } from "@/lib/format";
import type { DealView, TxView } from "@/lib/views";
import { requireSession } from "@/server/auth/guard";
import styles from "./settlements.module.css";

export const metadata: Metadata = { title: "Settlements" };

const SETTLEMENT_KINDS = new Set(["fund", "release", "resolve", "refund"]);
const OUTFLOWS = new Set(["release", "resolve", "refund"]);

const KIND_LABEL: Record<string, string> = {
  fund: "Funded",
  release: "Released",
  resolve: "Resolved",
  refund: "Refunded",
};

interface LedgerRow {
  tx: TxView;
  deal: DealView;
}

interface AssetTotals {
  code: string;
  isDemo: boolean;
  network: string;
  funded: bigint;
  released: bigint;
  refunded: bigint;
  balance: bigint;
  deals: number;
}

function totalsByAsset(deals: DealView[]): AssetTotals[] {
  const byKey = new Map<string, AssetTotals>();
  for (const d of deals) {
    if (!d.chain) continue;
    const key = `${d.asset.code}:${d.asset.contractId}:${d.network.id}`;
    const t = byKey.get(key) ?? { code: d.asset.code, isDemo: d.asset.isDemo, network: d.network.label, funded: 0n, released: 0n, refunded: 0n, balance: 0n, deals: 0 };
    t.funded += BigInt(d.chain.funded);
    t.released += BigInt(d.chain.released);
    t.refunded += BigInt(d.chain.refunded);
    t.balance += BigInt(d.chain.balance);
    t.deals += 1;
    byKey.set(key, t);
  }
  return [...byKey.values()];
}

function milestoneLabel(tx: TxView, deal: DealView): string {
  if (tx.milestoneOrdinal === null || tx.milestoneOrdinal < 0) return "Whole agreement";
  const name = deal.milestones.find((m) => m.ordinal === tx.milestoneOrdinal)?.name ?? "";
  return `M${tx.milestoneOrdinal + 1}${name ? ` · ${name}` : ""}`;
}

function roleOf(deal: DealView, address: string | undefined): string {
  const role = deal.participants.find((p) => p.address === address)?.role;
  return role ? role[0]!.toUpperCase() + role.slice(1) : "Payee";
}

function pathOf(tx: TxView, deal: DealView): { from: string; to: string; held?: boolean } {
  if (tx.kind === "fund") return { from: "Buyer", to: "Escrow", held: true };
  if (tx.kind === "refund") return { from: "Escrow", to: "Buyer" };
  if (tx.kind === "resolve") return { from: "Escrow", to: "Split" };
  return { from: "Escrow", to: roleOf(deal, deal.milestones.find((m) => m.ordinal === tx.milestoneOrdinal)?.payee) };
}

function sum(rows: LedgerRow[]): bigint {
  return rows.reduce((a, r) => a + BigInt(r.tx.amount ?? "0"), 0n);
}

export default async function SettlementsPage() {
  const session = await requireSession();
  const deals = await dealViews(session);
  const totals = totalsByAsset(deals);
  const settlementTxs: LedgerRow[] = deals
    .flatMap((deal) => deal.transactions.filter((tx) => SETTLEMENT_KINDS.has(tx.kind)).map((tx) => ({ tx, deal })))
    .sort((a, b) => b.tx.createdAt.localeCompare(a.tx.createdAt));
  const confirmed = settlementTxs.filter((r) => r.tx.status === "confirmed");
  const pending = settlementTxs.filter((r) => r.tx.status === "pending");
  const single = totals.length === 1 ? totals[0] : null;
  const deployed = deals.filter((d) => d.chain);
  const ledgerCodes = new Set(confirmed.map((r) => r.deal.asset.code));

  return (
    <>
      {deals.some((d) => d.isSample) ? <p className="sample-banner">Includes sample deals · synthetic parties · real testnet transactions</p> : null}
      <div className="page-head">
        <div>
          <h1>Settlements</h1>
          <div className="sub">
            <span>Read from each escrow contract and the token balance.</span>
          </div>
        </div>
      </div>

      <section className={styles.totals} aria-label="Held in escrow">
        {totals.length === 0 ? (
          <p className={styles.empty}>No escrow deployed yet.</p>
        ) : (
          totals.map((t) => {
            const holds = t.funded === t.released + t.refunded + t.balance;
            return (
              <div key={`${t.code}-${t.network}`} className={styles.asset}>
                <dl className={styles.strip}>
                  <div className={styles.lead}>
                    <dt>Held in escrow</dt>
                    <dd>
                      <Figure units={t.balance} code={t.code} size="xl" />
                    </dd>
                  </div>
                  <div>
                    <dt>Funded</dt>
                    <dd>
                      <Figure units={t.funded} size="md" />
                    </dd>
                  </div>
                  <div>
                    <dt>Released to payees</dt>
                    <dd>
                      <Figure units={t.released} size="md" />
                    </dd>
                  </div>
                  <div>
                    <dt>Refunded to buyers</dt>
                    <dd>
                      <Figure units={t.refunded} size="md" />
                    </dd>
                  </div>
                </dl>
                <p className={styles.check}>
                  {holds ? <SealCheck weight="fill" aria-hidden /> : <SealWarning weight="fill" aria-hidden />}
                  <span className={holds ? undefined : styles.bad}>{holds ? "Funded = released + refunded + held" : "Funded does not equal released + refunded + held. Reconcile first."}</span>
                  <span className={styles.dim}>
                    {t.code} · {t.network}
                    {t.isDemo ? " · demo token, not USDC" : ""} · {t.deals} escrow{t.deals === 1 ? "" : "s"}
                  </span>
                </p>
              </div>
            );
          })
        )}
      </section>

      <section className="panel" aria-labelledby="positions" style={{ marginBottom: 20 }}>
        <div className="panel-head">
          <h2 id="positions" className={styles.h2}>
            Escrow positions
          </h2>
          <span className={styles.meta}>
            {deployed.length} of {deals.length} deployed
          </span>
        </div>
        <div className={`panel-body flush table-scroll ${styles.scroll}`}>
          {deals.length === 0 ? (
            <p className={styles.empty}>
              No deals yet.{" "}
              <Link className="ext" href="/deals/new">
                Draft one
              </Link>
            </p>
          ) : (
            <table className={`table ${styles.table}`}>
              <thead>
                <tr>
                  <th scope="col">Deal</th>
                  <th scope="col" className={styles.railCol}>
                    Tranches
                  </th>
                  <th scope="col" className="num">
                    Funded
                  </th>
                  <th scope="col" className="num">
                    Released
                  </th>
                  <th scope="col" className="num">
                    Refunded
                  </th>
                  <th scope="col" className="num">
                    In escrow
                  </th>
                  <th scope="col">Contract</th>
                  <th scope="col">
                    <span className="sr-only">Settlement detail</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {deals.map((d) => {
                  const c = d.chain;
                  return (
                    <tr key={d.id}>
                      <td>
                        <Link className={styles.ref} href={`/deals/${d.id}`}>
                          {d.reference}
                        </Link>
                        <div className={styles.chipLine}>
                          <DealStatusChip status={d.status} />
                        </div>
                      </td>
                      <td className={styles.railCol}>{d.milestones.length > 0 ? <TrancheRail tranches={tranchesOf(d.milestones)} /> : <span className="faint tiny">No milestones</span>}</td>
                      <td className="num">{c ? <Figure units={c.funded} size="sm" /> : <span className="faint">-</span>}</td>
                      <td className="num">{c ? <Figure units={c.released} size="sm" /> : <span className="faint">-</span>}</td>
                      <td className="num">{c ? <Figure units={c.refunded} size="sm" /> : <span className="faint">-</span>}</td>
                      <td className="num">
                        {c ? <Figure units={c.balance} size="sm" /> : <span className="faint">-</span>}
                        {c && !c.conservationHolds ? <div className={styles.bad}>Reconcile</div> : null}
                      </td>
                      <td>
                        {c ? (
                          <>
                            <Hash value={c.contractId} href={c.contractExplorerUrl} label={`${d.reference} escrow contract`} />
                            <div className={styles.read} aria-live="polite">
                              {c.syncStatus === "unavailable" ? <span className={styles.bad}>RPC down · ledger {c.ledger}</span> : `${c.status} · ledger ${c.ledger}`}
                            </div>
                          </>
                        ) : (
                          <span className="faint tiny">Not deployed</span>
                        )}
                      </td>
                      <td>
                        <Link className="btn sm" href={`/deals/${d.id}/settlement`} aria-label={`Settlement detail for ${d.reference}`}>
                          Detail
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {single ? (
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={2}>
                      Total · {single.code}
                    </th>
                    <td className="num">
                      <Figure units={single.funded} size="sm" />
                    </td>
                    <td className="num">
                      <Figure units={single.released} size="sm" />
                    </td>
                    <td className="num">
                      <Figure units={single.refunded} size="sm" />
                    </td>
                    <td className="num">
                      <Figure units={single.balance} size="sm" />
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              ) : null}
            </table>
          )}
        </div>
      </section>

      <section className="panel" aria-label="Settlement ledger">
        <div className="panel-head">
          <h2 className={styles.h2}>Settlement ledger</h2>
          <Chip tone="confirmed">{confirmed.length} confirmed</Chip>
        </div>
        <div className={`panel-body flush table-scroll ${styles.scroll}`}>
          {confirmed.length === 0 ? (
            <p className={styles.empty}>Nothing confirmed on the ledger yet.</p>
          ) : (
            <table className={`table ${styles.table}`}>
              <thead>
                <tr>
                  <th scope="col">Confirmed</th>
                  <th scope="col">Deal</th>
                  <th scope="col">Movement</th>
                  <th scope="col" className="num">
                    Amount
                  </th>
                  <th scope="col">By</th>
                  <th scope="col" className="num">
                    Ledger
                  </th>
                  <th scope="col">Transaction</th>
                </tr>
              </thead>
              <tbody>
                {confirmed.map(({ tx, deal }) => (
                  <tr key={tx.id}>
                    <td className={styles.when}>{fmtDateTime(tx.createdAt)}</td>
                    <td>
                      <Link className={styles.ref} href={`/deals/${deal.id}/settlement`}>
                        {deal.reference}
                      </Link>
                    </td>
                    <td>
                      <div className={styles.move}>
                        <AccountPath {...pathOf(tx, deal)} />
                        <span className={styles.kind}>{KIND_LABEL[tx.kind] ?? tx.kind}</span>
                      </div>
                      <div className={styles.read}>{milestoneLabel(tx, deal)}</div>
                    </td>
                    <td className="num">
                      {tx.amount ? <Figure units={tx.amount} size="sm" /> : <span className="faint">-</span>}
                      {ledgerCodes.size > 1 ? <div className={styles.read}>{deal.asset.code}</div> : null}
                    </td>
                    <td className={styles.by}>{tx.actorName}</td>
                    <td className="num mono tiny">{tx.ledger ?? "-"}</td>
                    <td>{tx.txHash ? <Hash value={tx.txHash} href={tx.explorerUrl} label={`${deal.reference} ${tx.kind} transaction`} /> : <span className="faint">-</span>}</td>
                  </tr>
                ))}
              </tbody>
              {ledgerCodes.size === 1 ? (
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={3}>
                      Into escrow · {[...ledgerCodes][0]}
                    </th>
                    <td className="num">
                      <Figure units={sum(confirmed.filter((r) => r.tx.kind === "fund"))} size="sm" />
                    </td>
                    <td colSpan={3} />
                  </tr>
                  <tr>
                    <th scope="row" colSpan={3}>
                      Out of escrow · {[...ledgerCodes][0]}
                    </th>
                    <td className="num">
                      <Figure units={sum(confirmed.filter((r) => OUTFLOWS.has(r.tx.kind)))} size="sm" />
                    </td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              ) : null}
            </table>
          )}
        </div>
        {pending.length > 0 ? (
          <p className={styles.pending} aria-live="polite">
            <Chip tone="awaiting">Pending</Chip>
            {pending.length} awaiting ledger confirmation, not counted: {pending.map((r) => `${r.deal.reference} ${r.tx.kind}`).join(", ")}
          </p>
        ) : null}
      </section>
    </>
  );
}
