import { ArrowRight, CheckCircle, Circle, CircleDashed, DownloadSimple, Files, Receipt, Scales, SealCheck, SealWarning, WarningOctagon } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Chip, DealStatusChip } from "@/components/chip";
import { DealActions } from "@/components/deal/deal-actions";
import { MilestoneCard } from "@/components/deal/milestone-card";
import { SyncButton } from "@/components/deal/sync-button";
import { Hash } from "@/components/hash";
import { AccountPath } from "@/components/instruments/account-path";
import { Figure } from "@/components/instruments/figure";
import { LoadLineGauge } from "@/components/instruments/load-line-gauge";
import { TrancheRail } from "@/components/instruments/tranche-rail";
import { STATE_LABEL, tranchesOf } from "@/components/instruments/tranche";
import { LiveRefresh } from "@/components/live-refresh";
import { fmtDate, fmtDateTime, percentOf } from "@/lib/format";
import { dealInFlight } from "@/lib/in-flight";
import type { DealView, TxView } from "@/lib/views";
import { requireSession } from "@/server/auth/guard";
import { ApiError } from "@/server/http";
import { buildDealView } from "@/server/services/views";
import styles from "./cockpit.module.css";

export const metadata: Metadata = { title: "Agreement" };

const SETTLED = new Set(["Released", "Resolved", "Refunded"]);

function agreementSteps(deal: DealView) {
  const c = deal.chain;
  const steps = [
    { label: "Terms frozen", done: deal.status !== "draft", detail: `v${deal.version}` },
    { label: "Escrow deployed", done: Boolean(c || deal.deployTxHash), detail: "" },
    { label: "Both signed", done: Boolean(c?.buyerAccepted && c?.supplierAccepted), detail: c ? `${Number(c.buyerAccepted) + Number(c.supplierAccepted)}/2` : "" },
    { label: "Funded", done: c ? BigInt(c.total) > 0n && BigInt(c.funded) === BigInt(c.total) : false, detail: c ? `${percentOf(c.funded, c.total)}%` : "" },
    ...deal.milestones.map((m) => ({
      label: m.name,
      done: m.chainStatus !== null && SETTLED.has(m.chainStatus),
      bad: m.chainStatus === "Disputed" || m.openBlockingFindings > 0,
      detail: m.chainStatus === "Open" ? "" : (m.chainStatus ?? ""),
    })),
  ];
  const firstOpen = steps.findIndex((s) => !s.done);
  return steps.map((s, i) => ({ ...s, current: i === firstOpen }));
}

const MOVES: Record<string, (deal: DealView, t: TxView) => { from: string; to: string; held?: boolean } | null> = {
  fund: () => ({ from: "Buyer", to: "Escrow", held: true }),
  release: (deal, t) => ({ from: "Escrow", to: roleOf(deal, deal.milestones.find((m) => m.ordinal === t.milestoneOrdinal)?.payee) }),
  refund: () => ({ from: "Escrow", to: "Buyer" }),
  resolve: () => ({ from: "Escrow", to: "Split" }),
};

function roleOf(deal: DealView, address: string | undefined): string {
  const p = deal.participants.find((x) => x.address === address);
  return p ? p.role[0]!.toUpperCase() + p.role.slice(1) : "Payee";
}

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
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
  const steps = agreementSteps(deal);
  const tranches = tranchesOf(deal.milestones);
  const blocking = deal.documentsSummary.openBlocking;
  const openDispute = deal.disputes.find((d) => d.status !== "resolved");
  const heldAt = deal.milestones.find((m) => m.openBlockingFindings > 0);
  const settledCount = deal.milestones.filter((m) => m.chainStatus !== null && SETTLED.has(m.chainStatus)).length;
  const moves = deal.transactions.filter((t) => t.status === "confirmed" && t.kind in MOVES).slice(0, 8);
  const goods = deal.terms.goods;
  const nextUp = tranches.find((t) => t.state !== "released" && t.state !== "refunded");

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
          <h1 className={styles.title}>{deal.title}</h1>
          <div className={styles.meta}>
            <DealStatusChip status={deal.status} />
            <span>
              {deal.terms.buyer.legalName} <ArrowRight aria-label="to" /> {deal.terms.supplier.legalName}
            </span>
            <span className="mono tiny">
              {goods.incoterm.rule} {goods.incoterm.namedPlace}
            </span>
            <span className="tiny faint">You: {deal.myRoles.join(", ")}</span>
          </div>
        </div>
        <nav className="btn-group" aria-label="Agreement views">
          <Link className="btn" href={`/deals/${deal.id}/documents`} aria-label={blocking > 0 ? `Documents · ${blocking} blocking` : "Documents"}>
            <Files aria-hidden />
            Documents
            {blocking > 0 ? <span className={styles.count}>{blocking}</span> : null}
          </Link>
          <Link className="btn" href={`/deals/${deal.id}/settlement`}>
            <Receipt aria-hidden />
            Settlement
          </Link>
          <a className="btn ghost" href={`/api/v1/deals/${deal.id}/export`} aria-label="Export record">
            <DownloadSimple aria-hidden />
            Export
          </a>
        </nav>
      </header>
      <LiveRefresh active={dealInFlight(deal)} ledgerReadAt={c?.syncedAt ?? null} />

      <section className={styles.hero} aria-label="Escrow position">
        <div className={styles.gauge}>
          <LoadLineGauge tranches={tranches} funded={BigInt(c?.funded ?? "0")} total={BigInt(deal.terms.totalUnits)} code={code} />
        </div>

        <div className={styles.readout}>
          <div>
            <div className={styles.balanceLabel}>
              <span className="eyebrow">In escrow</span>
              {deal.asset.isDemo ? <Chip tone="neutral">Demo token</Chip> : null}
            </div>
            <div style={{ marginTop: 10 }}>{c ? <Figure units={c.balance} code={code} size="xl" /> : <span className="hero-amount faint">Not deployed</span>}</div>
          </div>
          <dl className={styles.stats}>
            <div>
              <dt>Total</dt>
              <dd>
                <Figure units={deal.terms.totalUnits} size="sm" />
              </dd>
            </div>
            <div>
              <dt>Funded</dt>
              <dd>{c ? <Figure units={c.funded} size="sm" /> : <span className="faint">0</span>}</dd>
            </div>
            <div>
              <dt>Released</dt>
              <dd>{c ? <Figure units={c.released} size="sm" /> : <span className="faint">0</span>}</dd>
            </div>
            <div>
              <dt>Refunded</dt>
              <dd>{c ? <Figure units={c.refunded} size="sm" /> : <span className="faint">0</span>}</dd>
            </div>
          </dl>
          <TrancheRail tranches={tranches} size="thick" labels legend />
          {c ? (
            c.conservationHolds ? (
              <span className={styles.balanced}>
                <SealCheck weight="fill" aria-hidden />
                Funded = released + refunded + balance, checked against the token contract.
              </span>
            ) : (
              <span className={styles.unbalanced}>
                <SealWarning weight="fill" aria-hidden />
                Out of balance with the token contract. Reconcile before acting.
              </span>
            )
          ) : null}
        </div>

        <div className={styles.next}>
          <span className="eyebrow">Next</span>
          <DealActions deal={deal} />
          {nextUp && c?.status === "Funded" ? (
            <a className={`${styles.nextUp} ${styles[nextUp.state]}`} href={`#m-${nextUp.ordinal}`}>
              <span className="eyebrow">Next payout · M{nextUp.ordinal + 1}</span>
              <strong>{nextUp.name}</strong>
              <span className="spread">
                <Figure units={nextUp.amount} code={code} size="md" />
                <span className={styles.nextState}>{STATE_LABEL[nextUp.state]}</span>
              </span>
            </a>
          ) : null}
          <div className={styles.ledgerRead}>
            {c ? (
              c.syncStatus === "unavailable" ? (
                <span className={styles.stale}>RPC down. Last read at ledger {c.ledger}.</span>
              ) : (
                <span aria-live="polite">
                  <strong>{c.status}</strong> at ledger {c.ledger}
                  <br />
                  {fmtDateTime(c.syncedAt)}
                </span>
              )
            ) : (
              <span>No ledger read yet</span>
            )}
            <SyncButton dealId={deal.id} />
          </div>
        </div>
      </section>

      {heldAt || openDispute ? (
        <div className={styles.alerts}>
          {heldAt ? (
            <div className={styles.alert} role="status">
              <WarningOctagon weight="fill" aria-hidden />
              {blocking} blocking mismatch{blocking === 1 ? " holds" : "es hold"} {heldAt.name}.
              <Link href={`/deals/${deal.id}/documents`}>Compare</Link>
            </div>
          ) : null}
          {openDispute ? (
            <div className={styles.alert}>
              <Scales weight="fill" aria-hidden />
              Milestone {openDispute.milestoneOrdinal + 1} is frozen by a dispute.
              <Link href={`/deals/${deal.id}/disputes/${openDispute.milestoneOrdinal}`}>Open record</Link>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid-cockpit">
        <section className="stack" aria-label="Milestones">
          <div className={styles.sectionHead}>
            <h2>Milestones</h2>
            <span>
              {settledCount}/{deal.milestones.length} settled
            </span>
          </div>
          {deal.milestones.map((m) => (
            <MilestoneCard key={m.ordinal} deal={deal} m={m} />
          ))}

          {deal.shipment ? (
            <article className="panel" id="shipment">
              <div className="panel-head">
                <div>
                  <h2 style={{ fontSize: 15 }}>Shipment</h2>
                  <p className="sub">
                    {deal.shipment.originPort} <ArrowRight aria-label="to" style={{ verticalAlign: -2 }} /> {deal.shipment.destinationPort}
                    {deal.shipment.vessel ? ` · ${deal.shipment.vessel} ${deal.shipment.voyage ?? ""}` : ""}
                  </p>
                </div>
                <Chip tone="neutral">{deal.shipment.stage.replaceAll("_", " ")}</Chip>
              </div>
              <div className="panel-body flush table-scroll">
                {deal.shipment.events.length === 0 ? (
                  <p className="empty">No transport events yet.</p>
                ) : (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Event</th>
                        <th>When</th>
                        <th>Source</th>
                        <th>Signed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deal.shipment.events.map((e) => (
                        <tr key={e.id}>
                          <td>
                            <span className="mono tiny">{e.eventCode}</span>
                            <div className="small">{e.description}</div>
                          </td>
                          <td className="mono tiny">{fmtDateTime(e.occurredAt)}</td>
                          <td>
                            <Chip tone="neutral">{e.sourceType.replaceAll("_", " ")}</Chip>
                            {e.sourceRef ? <div className="tiny faint mono">{e.sourceRef}</div> : null}
                          </td>
                          <td className="small">{e.isAttestation ? (e.signerName ?? e.signerAddress) : <span className="faint">Context</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="panel-body spread" style={{ borderTop: "1px solid var(--line)", padding: "12px 18px" }}>
                <p className="tiny muted">Carrier events are context. Only approver signatures release funds.</p>
                <Link className="ext tiny" href={`/shipments?deal=${deal.id}`}>
                  Attest an event
                </Link>
              </div>
            </article>
          ) : null}
        </section>

        <aside className="stack" aria-label="Agreement record">
          <div className="panel">
            <div className="panel-head">
              <h2 style={{ fontSize: 15 }}>Money moved</h2>
              <Link className="ext tiny" href={`/deals/${deal.id}/settlement`}>
                Ledger
              </Link>
            </div>
            {moves.length === 0 ? (
              <p className="empty">Nothing has moved yet.</p>
            ) : (
              <ul className={styles.moves}>
                {moves.map((t) => {
                  const path = MOVES[t.kind]!(deal, t);
                  return path ? (
                    <li key={t.id}>
                      <AccountPath {...path} />
                      {t.amount ? <Figure units={t.amount} size="sm" /> : <span />}
                      <small>
                        {t.milestoneOrdinal !== null ? `M${t.milestoneOrdinal + 1} · ` : ""}
                        {fmtDateTime(t.createdAt)}
                        {t.txHash ? <Hash value={t.txHash} href={t.explorerUrl} label={`${t.kind} transaction`} /> : null}
                      </small>
                    </li>
                  ) : null;
                })}
              </ul>
            )}
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2 style={{ fontSize: 15 }}>Progress</h2>
              <Link className="ext tiny" href={`/activity?deal=${deal.id}`}>
                Audit trail
              </Link>
            </div>
            <div className="panel-body" style={{ paddingTop: 10, paddingBottom: 10 }}>
              <ol className={styles.steps}>
                {steps.map((s) => (
                  <li key={s.label} className={`${styles.step} ${s.done ? styles.done : ""} ${s.current ? styles.current : ""} ${"bad" in s && s.bad ? styles.bad : ""}`}>
                    {s.done ? <CheckCircle weight="fill" aria-label="Done" /> : s.current ? <CircleDashed weight="bold" aria-label="Current" /> : <Circle aria-label="Pending" />}
                    <span>{s.label}</span>
                    <span>{s.detail}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2 style={{ fontSize: 15 }}>Proof</h2>
              <Link className="ext tiny" href={`/verify/${deal.publicRef}`}>
                Public page
              </Link>
            </div>
            <div className="panel-body">
              <dl className="kv">
                <dt>Escrow</dt>
                <dd>{c ? <Hash value={c.contractId} href={c.contractExplorerUrl} label="escrow contract" /> : <span className="faint">Not deployed</span>}</dd>
                <dt>Terms</dt>
                <dd>{deal.termsDigest ? <Hash value={deal.termsDigest} label="terms digest" /> : <span className="faint">Draft</span>}</dd>
                <dt>{code}</dt>
                <dd>
                  <Hash value={deal.asset.contractId} label="token contract" />
                </dd>
              </dl>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2 style={{ fontSize: 15 }}>Parties</h2>
              <span className="tiny faint">Fund by {fmtDate(deal.terms.fundingDeadline * 1000)}</span>
            </div>
            <div>
              {deal.participants.map((p) => (
                <div key={`${p.role}-${p.address}`} className={styles.party}>
                  <span className={styles.role}>{p.role}</span>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.name}
                    {p.isMe ? <span className={styles.you}>YOU</span> : null}
                  </span>
                  <span className="mono tiny faint">{p.address ? `${p.address.slice(0, 4)}…${p.address.slice(-4)}` : p.status}</span>
                </div>
              ))}
            </div>
            <p className="tiny faint" style={{ padding: "10px 18px 14px", borderTop: "1px solid var(--line)" }}>
              {deal.terms.governingLaw} law · {deal.terms.disputeForum}
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
