import { ArrowLeft, DownloadSimple, Files, HourglassMedium, Scales, SealCheck, SealWarning, WifiSlash } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Chip, MilestonePhaseChip, type ChipTone } from "@/components/chip";
import { Hash } from "@/components/hash";
import { AccountPath } from "@/components/instruments/account-path";
import { Figure } from "@/components/instruments/figure";
import { TrancheRail } from "@/components/instruments/tranche-rail";
import { tranchesOf } from "@/components/instruments/tranche";
import { LiveRefresh } from "@/components/live-refresh";
import { fmtDateTime, percentOf, shortAddress } from "@/lib/format";
import { chainInFlight } from "@/lib/in-flight";
import type { DealView, MilestoneView, TxView } from "@/lib/views";
import { requireSession } from "@/server/auth/guard";
import { ApiError } from "@/server/http";
import { buildDealView } from "@/server/services/views";
import styles from "./settlement.module.css";

export const metadata: Metadata = { title: "Settlement" };

type StepState = "done" | "current" | "pending" | "bad";

interface Step {
  label: string;
  state: StepState;
  detail: string;
}

const SETTLING_KINDS = new Set(["release", "resolve", "refund"]);
const SETTLED = new Set(["Released", "Resolved", "Refunded"]);
const STEP_WORD: Record<StepState, string> = { done: "Done", current: "Current", pending: "Not yet", bad: "Held" };

/** Derived only from the ledger readback and recorded chain transactions; nothing is inferred from intent. */
function settlementSteps(deal: DealView, m: MilestoneView): Step[] {
  const c = deal.chain;
  const funded = c ? BigInt(c.total) > 0n && BigInt(c.funded) >= BigInt(c.total) : false;
  const settled = m.chainStatus !== null && SETTLED.has(m.chainStatus);
  const txs = deal.transactions.filter((t) => t.milestoneOrdinal === m.ordinal && SETTLING_KINDS.has(t.kind));
  const pending = txs.find((t) => t.status === "pending");
  const phase = m.gate?.phase ?? null;
  const disputed = m.chainStatus === "Disputed";
  const eligible = phase === "eligible";

  const conditionsDetail = disputed
    ? "Frozen by dispute"
    : m.openBlockingFindings > 0
      ? `${m.openBlockingFindings} blocking finding${m.openBlockingFindings === 1 ? "" : "s"}`
      : m.missingDocuments.length > 0
        ? `Missing ${m.missingDocuments.join(", ")}`
        : m.gate
          ? `${m.gate.approvals}/${m.gate.quorum} approvals${m.evidenceDigest ? "" : ", no evidence"}`
          : "Escrow not read yet";

  const raw: { label: string; done: boolean; bad?: boolean; detail: string }[] = [
    { label: "Funding", done: funded, detail: c ? `${percentOf(c.funded, c.total)}% funded` : "No escrow" },
    { label: "Conditions", done: settled || eligible || Boolean(pending), bad: disputed || phase === "blocked", detail: settled || eligible ? "Met" : conditionsDetail },
    { label: "Eligible", done: settled || Boolean(pending), detail: eligible ? "Release open" : "" },
    { label: "Processing", done: settled, detail: pending ? "Awaiting ledger" : settled ? "In a ledger" : "" },
    { label: "Confirmed", done: settled, detail: settled ? `${m.chainStatus}${m.settlementTx?.ledger ? ` at ledger ${m.settlementTx.ledger}` : ""}` : "" },
  ];
  const firstOpen = raw.findIndex((s) => !s.done);
  return raw.map((s, i) => ({ label: s.label, detail: s.detail, state: s.done ? "done" : s.bad ? "bad" : i === firstOpen ? "current" : "pending" }));
}

const TX_STATUS: Record<string, [ChipTone, string]> = {
  confirmed: ["confirmed", "Confirmed"],
  pending: ["awaiting", "Awaiting ledger"],
  failed: ["blocked", "Failed"],
  rejected_in_simulation: ["blocked", "Rejected"],
};

const TX_KIND: Record<string, string> = {
  deploy: "Deploy escrow",
  accept: "Accept terms",
  fund: "Fund escrow",
  anchor: "Anchor evidence",
  approve: "Approve milestone",
  revoke: "Revoke approval",
  release: "Release milestone",
  refund: "Refund to buyer",
  dispute: "Open dispute",
  resolve: "Resolve dispute",
  cancel: "Cancel unfunded",
};

const moves = (t: TxView) => t.amount !== null && (t.kind === "fund" || SETTLING_KINDS.has(t.kind));

/**
 * Walks confirmed transfers in ledger order to show the escrow balance after each one.
 * Only shown when the walk ends at the balance read from the token contract.
 */
function escrowAfter(deal: DealView): { after: Map<string, bigint>; matches: boolean } {
  const after = new Map<string, bigint>();
  const confirmed = deal.transactions.filter((t) => t.status === "confirmed" && moves(t)).sort((a, b) => (a.ledger ?? 0) - (b.ledger ?? 0));
  let balance = 0n;
  for (const t of confirmed) {
    const amount = BigInt(t.amount ?? "0");
    balance += t.kind === "fund" ? amount : -amount;
    after.set(t.id, balance);
  }
  return { after, matches: deal.chain !== null && balance === BigInt(deal.chain.balance) };
}

function roleOf(deal: DealView, address: string | undefined): string {
  const role = deal.participants.find((p) => p.address === address)?.role;
  return role ? role[0]?.toUpperCase() + role.slice(1) : "Payee";
}

function pathOf(deal: DealView, t: TxView): { from: string; to: string; held?: boolean } | null {
  if (t.kind === "fund") return { from: "Buyer", to: "Escrow", held: true };
  if (t.kind === "release") return { from: "Escrow", to: roleOf(deal, deal.milestones.find((m) => m.ordinal === t.milestoneOrdinal)?.payee) };
  if (t.kind === "refund") return { from: "Escrow", to: "Buyer" };
  if (t.kind === "resolve") return { from: "Escrow", to: "Split" };
  return null;
}

interface PayeeAccount {
  address: string;
  name: string;
  role: string;
  received: bigint;
  inEscrow: bigint;
  milestones: MilestoneView[];
}

/** Per-payee position from milestone settlement; resolved tranches count only the payee's side of the split. */
function payeeAccounts(deal: DealView): PayeeAccount[] {
  const byAddress = new Map<string, PayeeAccount>();
  for (const m of deal.milestones) {
    const acc = byAddress.get(m.payee) ?? { address: m.payee, name: m.payeeName, role: roleOf(deal, m.payee), received: 0n, inEscrow: 0n, milestones: [] };
    const resolution = deal.disputes.find((d) => d.milestoneOrdinal === m.ordinal)?.resolution;
    if (m.chainStatus === "Released") acc.received += BigInt(m.amount);
    else if (m.chainStatus === "Resolved") acc.received += BigInt(resolution?.toPayee ?? "0");
    else if (m.chainStatus !== "Refunded") acc.inEscrow += BigInt(m.amount);
    acc.milestones.push(m);
    byAddress.set(m.payee, acc);
  }
  return [...byAddress.values()];
}

function TxStatus({ t }: { t: TxView }) {
  const [tone, label] = TX_STATUS[t.status] ?? ["neutral", t.status];
  return (
    <>
      <Chip tone={tone}>{label}</Chip>
      {t.status === "rejected_in_simulation" ? (
        <div className={styles.txError}>
          Contract rejected: <span className="mono">{t.errorCode ?? "unknown"}</span>
          {t.errorDetail ? <div className="tiny muted">{t.errorDetail}</div> : null}
        </div>
      ) : null}
      {t.status === "failed" && t.errorDetail ? <div className="tiny muted">{t.errorDetail}</div> : null}
    </>
  );
}

function Entry({ deal, t }: { deal: DealView; t: TxView }) {
  const label = t.kind === "fund" ? "Funded" : t.kind === "release" ? `Released to ${roleOf(deal, deal.milestones.find((m) => m.ordinal === t.milestoneOrdinal)?.payee).toLowerCase()}` : t.kind === "refund" ? "Refunded to buyer" : "Resolver split";
  return (
    <li className={`${styles.entry} ${styles[t.kind] ?? ""}`}>
      <span className={styles.entryWhat}>
        <i aria-hidden />
        {t.milestoneOrdinal !== null ? `M${t.milestoneOrdinal + 1} · ` : ""}
        {label}
        <small>{fmtDateTime(t.createdAt)}</small>
      </span>
      <Figure units={t.amount ?? "0"} size="sm" />
    </li>
  );
}

export default async function SettlementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  let deal: DealView;
  try {
    deal = await buildDealView(session, id);
  } catch (e) {
    if (e instanceof ApiError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const c = deal.chain;
  const code = deal.asset.code;
  const { after, matches } = escrowAfter(deal);
  const pendingCount = deal.transactions.filter((t) => t.status === "pending").length;
  const rejected = deal.transactions.filter((t) => t.status === "rejected_in_simulation").length;
  const buyer = deal.participants.find((p) => p.role === "buyer");
  const ledgerOrder = [...deal.transactions].filter((t) => t.status === "confirmed" && moves(t)).sort((a, b) => (a.ledger ?? 0) - (b.ledger ?? 0));
  const ins = ledgerOrder.filter((t) => t.kind === "fund");
  const outs = ledgerOrder.filter((t) => t.kind !== "fund");
  const payees = payeeAccounts(deal);
  const tranches = tranchesOf(deal.milestones);
  const settledCount = deal.milestones.filter((m) => m.chainStatus !== null && SETTLED.has(m.chainStatus)).length;

  return (
    <>
      {deal.isSample ? <p className="sample-banner">Sample deal · synthetic parties · real {deal.network.label} transactions · {code} is a demo token</p> : null}

      <header className={styles.head}>
        <div>
          <p className={styles.ref}>
            {deal.reference}
            <span>/</span>
            {deal.terms.poNumber}
          </p>
          <h1 className={styles.title}>Settlement</h1>
          <div className={styles.meta}>
            <span>{deal.title}</span>
            <span className="mono tiny">
              {code} · {deal.network.label}
            </span>
            {deal.asset.isDemo ? <Chip tone="neutral">Demo token</Chip> : null}
            <span className="tiny faint">
              {deal.transactions.length} chain transaction{deal.transactions.length === 1 ? "" : "s"}
              {rejected > 0 ? `, ${rejected} rejected in simulation` : ""}
            </span>
          </div>
        </div>
        <nav className="btn-group" aria-label="Agreement views">
          <Link className="btn" href={`/deals/${deal.id}`}>
            <ArrowLeft aria-hidden />
            Agreement
          </Link>
          <Link className="btn" href={`/deals/${deal.id}/documents`}>
            <Files aria-hidden />
            Documents
          </Link>
          <a className="btn ghost" href={`/api/v1/deals/${deal.id}/export`}>
            <DownloadSimple aria-hidden />
            Export record
          </a>
        </nav>
      </header>
      <LiveRefresh active={chainInFlight(deal)} ledgerReadAt={c?.syncedAt ?? null} />

      {pendingCount > 0 || c?.syncStatus === "unavailable" ? (
        <div className={styles.notices} aria-live="polite">
          {pendingCount > 0 ? (
            <p className={styles.notice}>
              <HourglassMedium weight="fill" aria-hidden />
              {pendingCount} transaction{pendingCount === 1 ? "" : "s"} awaiting ledger confirmation. Not settled until read back.
            </p>
          ) : null}
          {c?.syncStatus === "unavailable" ? (
            <p className={styles.notice}>
              <WifiSlash weight="bold" aria-hidden />
              RPC down. Figures are from the last good read at ledger {c.ledger}.
            </p>
          ) : null}
        </div>
      ) : null}

      <section className={styles.house} aria-labelledby="house-title">
        <div className={styles.houseHead}>
          <h2 id="house-title">Clearing house</h2>
          <span>{c ? `${c.status} · read at ledger ${c.ledger}` : "No escrow on-chain"}</span>
        </div>

        {c ? (
          <>
            <div className={styles.houseGrid}>
              <div className={styles.tAccount} role="group" aria-label="Escrow account">
                <p className={styles.tName}>Escrow</p>
                <div className={styles.t}>
                  <div className={styles.tSide}>
                    <p className={styles.tHead}>In</p>
                    {ins.length === 0 ? <p className={styles.tEmpty}>Nothing funded</p> : <ul className={styles.entries}>{ins.map((t) => <Entry key={t.id} deal={deal} t={t} />)}</ul>}
                    <div className={styles.tTotal}>
                      <span>Funded</span>
                      <Figure units={c.funded} size="md" />
                    </div>
                  </div>
                  <div className={styles.tSide}>
                    <p className={styles.tHead}>Out</p>
                    {outs.length === 0 ? <p className={styles.tEmpty}>Nothing paid out</p> : <ul className={styles.entries}>{outs.map((t) => <Entry key={t.id} deal={deal} t={t} />)}</ul>}
                    <div className={styles.tTotal}>
                      <span>Paid out</span>
                      <Figure units={BigInt(c.released) + BigInt(c.refunded)} size="md" />
                    </div>
                  </div>
                </div>
                <div className={styles.tBalance}>
                  <span>Balance held</span>
                  <Figure units={c.balance} code={code} size="lg" />
                </div>
              </div>

              <div className={styles.accounts} role="group" aria-label="Party accounts">
                <div className={styles.account}>
                  <div className={styles.accountHead}>
                    <span className={styles.role}>Buyer</span>
                    <span className={styles.accountName}>{buyer?.name ?? deal.terms.buyer.legalName}</span>
                  </div>
                  <dl className={styles.accountFigures}>
                    <div>
                      <dt>Paid in</dt>
                      <dd>
                        <Figure units={c.funded} size="sm" />
                      </dd>
                    </div>
                    <div>
                      <dt>Refunded</dt>
                      <dd>
                        <Figure units={c.refunded} size="sm" />
                      </dd>
                    </div>
                  </dl>
                </div>
                {payees.map((p) => (
                  <div key={p.address} className={styles.account}>
                    <div className={styles.accountHead}>
                      <span className={styles.role}>{p.role}</span>
                      <span className={styles.accountName}>{p.name}</span>
                      <span className="mono tiny faint">{shortAddress(p.address)}</span>
                    </div>
                    <dl className={styles.accountFigures}>
                      <div>
                        <dt>Received</dt>
                        <dd className={p.received > 0n ? styles.moved : ""}>
                          <Figure units={p.received} size="sm" />
                        </dd>
                      </div>
                      <div>
                        <dt>Still in escrow</dt>
                        <dd>
                          <Figure units={p.inEscrow} size="sm" />
                        </dd>
                      </div>
                    </dl>
                    <TrancheRail tranches={tranches.filter((t) => p.milestones.some((m) => m.ordinal === t.ordinal))} />
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.equation} role="group" aria-label="Conservation check">
              <span className={styles.term}>
                <small>Funded</small>
                <Figure units={c.funded} size="md" />
              </span>
              <span className={styles.op} aria-label="equals">
                =
              </span>
              <span className={styles.term}>
                <small>Released</small>
                <Figure units={c.released} size="md" />
              </span>
              <span className={styles.op} aria-label="plus">
                +
              </span>
              <span className={styles.term}>
                <small>Refunded</small>
                <Figure units={c.refunded} size="md" />
              </span>
              <span className={styles.op} aria-label="plus">
                +
              </span>
              <span className={styles.term}>
                <small>Balance</small>
                <Figure units={c.balance} size="md" />
              </span>
              {c.conservationHolds ? (
                <span className={styles.seal}>
                  <SealCheck weight="fill" aria-hidden />
                  Holds against the token contract
                </span>
              ) : (
                <span className={`${styles.seal} ${styles.sealBad}`}>
                  <SealWarning weight="fill" aria-hidden />
                  Out of balance. Reconcile before acting.
                </span>
              )}
            </div>
          </>
        ) : (
          <p className="empty">
            <strong>No escrow deployed</strong>
            Balances appear once the escrow contract is live.
          </p>
        )}
      </section>

      <div className="grid-cockpit">
        <section className="stack" aria-labelledby="tranches-title">
          <div className={styles.sectionHead}>
            <h2 id="tranches-title">Tranches</h2>
            <span>
              {settledCount}/{deal.milestones.length} settled
            </span>
          </div>
          {deal.milestones.map((m) => {
            const steps = settlementSteps(deal, m);
            const dispute = deal.disputes.find((d) => d.milestoneOrdinal === m.ordinal);
            const settled = m.chainStatus !== null && SETTLED.has(m.chainStatus);
            return (
              <article key={m.ordinal} className={`${styles.tranche} ${settled ? styles.trancheSettled : ""}`} aria-labelledby={`sm-${m.ordinal}`}>
                <header className={styles.trancheHead}>
                  <span className={styles.index}>{m.ordinal + 1}</span>
                  <h3 id={`sm-${m.ordinal}`} className="grow">
                    {m.name}
                  </h3>
                  <Figure units={m.amount} size="md" />
                  {m.gate ? <MilestonePhaseChip phase={m.gate.phase} /> : <Chip tone="neutral">Not deployed</Chip>}
                </header>
                <ol className={styles.track} aria-label={`Settlement progress for milestone ${m.ordinal + 1}`}>
                  {steps.map((s) => (
                    <li key={s.label} className={`${styles.step} ${styles[s.state]}`} aria-current={s.state === "current" ? "step" : undefined}>
                      <span className={styles.bar} aria-hidden="true" />
                      <strong>{s.label}</strong>
                      <small>
                        {s.detail ? (
                          <>
                            <span className="sr-only">{STEP_WORD[s.state]}: </span>
                            {s.detail}
                          </>
                        ) : (
                          STEP_WORD[s.state]
                        )}
                      </small>
                    </li>
                  ))}
                </ol>
                <dl className={styles.trancheFacts}>
                  <div>
                    <dt>Payee</dt>
                    <dd>
                      {m.payeeName} <Hash value={m.payee} label={`${m.payeeName} payout address`} />
                    </dd>
                  </div>
                  {dispute?.resolution ? (
                    <div>
                      <dt>Resolver split</dt>
                      <dd className="mono tiny">
                        <Figure units={dispute.resolution.toBuyer} size="sm" /> to {buyer?.name ?? "buyer"} · <Figure units={dispute.resolution.toPayee} size="sm" /> to {m.payeeName}
                      </dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Settlement tx</dt>
                    <dd>
                      {m.settlementTx?.txHash ? (
                        <>
                          <Hash value={m.settlementTx.txHash} href={m.settlementTx.explorerUrl} label="settlement transaction" /> <span className="tiny faint mono">ledger {m.settlementTx.ledger}</span>
                        </>
                      ) : (
                        <span className="faint">None confirmed</span>
                      )}
                    </dd>
                  </div>
                </dl>
                {dispute && dispute.status !== "resolved" ? (
                  <Link className={styles.disputeLink} href={`/deals/${deal.id}/disputes/${m.ordinal}`}>
                    <Scales weight="fill" aria-hidden />
                    Frozen by dispute
                    <span>Open record</span>
                  </Link>
                ) : null}
              </article>
            );
          })}
        </section>

        <aside className="stack" aria-label="Ledger source">
          <div className="panel">
            <div className="panel-head">
              <h2 style={{ fontSize: 15 }}>Source</h2>
              <span className="tiny faint">Confirmed ledger results only</span>
            </div>
            <div className="panel-body">
              <dl className="kv">
                <dt>Escrow</dt>
                <dd>{c ? <Hash value={c.contractId} href={c.contractExplorerUrl} label="escrow contract" /> : <span className="faint">Not deployed</span>}</dd>
                <dt>{code}</dt>
                <dd>
                  <Hash value={deal.asset.contractId} label="token contract" />
                </dd>
                <dt>State</dt>
                <dd className="small">{c ? c.status : <span className="faint">Not deployed</span>}</dd>
                <dt>Read at</dt>
                <dd className="small">
                  {c ? (
                    <>
                      ledger <span className="mono">{c.ledger}</span>
                      <span className="tiny faint mono" style={{ display: "block" }}>
                        {c.syncStatus === "unavailable" ? "RPC down, last good read" : fmtDateTime(c.syncedAt)}
                      </span>
                    </>
                  ) : (
                    <span className="faint">Never</span>
                  )}
                </dd>
              </dl>
            </div>
          </div>
        </aside>
      </div>

      <section className="panel" style={{ marginTop: 20 }} aria-labelledby="tx-title">
        <div className="panel-head">
          <h2 id="tx-title" style={{ fontSize: 15 }}>
            Ledger
          </h2>
          <span className="tiny faint">{after.size > 0 ? (matches ? "Newest first · escrow after matches the readback" : "Newest first · derived balances don't match the readback, so they're hidden") : "Newest first"}</span>
        </div>
        <div className="panel-body flush table-scroll">
          {deal.transactions.length === 0 ? (
            <p className="empty">
              <strong>No chain transactions yet</strong>
              They appear once the escrow is deployed.
            </p>
          ) : (
            <table className={`table ${styles.ledger}`}>
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Movement</th>
                  <th>Actor</th>
                  <th>Status</th>
                  <th className="num">Ledger</th>
                  <th className="num">Amount ({code})</th>
                  <th className="num">Escrow after</th>
                  <th>Transaction</th>
                </tr>
              </thead>
              <tbody>
                {deal.transactions.map((t) => {
                  const balance = matches ? after.get(t.id) : undefined;
                  const path = pathOf(deal, t);
                  return (
                    <tr key={t.id}>
                      <td>
                        <span className="small">{TX_KIND[t.kind] ?? t.kind}</span>
                        <div className="tiny faint mono">
                          {t.milestoneOrdinal !== null ? `M${t.milestoneOrdinal + 1} · ` : ""}
                          {fmtDateTime(t.createdAt)}
                        </div>
                      </td>
                      <td className={styles.nowrap}>{path && moves(t) ? <AccountPath {...path} /> : <span className="faint">·</span>}</td>
                      <td className="small">
                        {t.actorName}
                        <div className="tiny faint mono">{shortAddress(t.actorAddress)}</div>
                      </td>
                      <td>
                        <TxStatus t={t} />
                      </td>
                      <td className="num tiny">{t.ledger ?? (t.status === "pending" ? "pending" : <span className="faint">·</span>)}</td>
                      <td className="num">{t.amount && moves(t) ? <Figure units={t.amount} size="sm" /> : <span className="faint">·</span>}</td>
                      <td className="num">{balance !== undefined ? <Figure units={balance} size="sm" /> : <span className="faint">·</span>}</td>
                      <td className={styles.nowrap}>{t.txHash ? <Hash value={t.txHash} href={t.explorerUrl} label={`${TX_KIND[t.kind] ?? t.kind} transaction`} /> : <span className="tiny faint">Not submitted</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </>
  );
}
