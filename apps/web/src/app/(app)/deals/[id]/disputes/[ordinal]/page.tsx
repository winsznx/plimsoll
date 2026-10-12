import { ArrowLeft, CheckCircle, Files, Receipt, Scales } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Chip, MilestonePhaseChip, type ChipTone } from "@/components/chip";
import { ResolutionForm } from "@/components/disputes/resolution-form";
import { SplitBar } from "@/components/disputes/split-bar";
import { StatementForm } from "@/components/disputes/statement-form";
import { AnalysisChip, documentTypeLabel } from "@/components/documents/status";
import { Hash } from "@/components/hash";
import { Figure } from "@/components/instruments/figure";
import { TrancheRail } from "@/components/instruments/tranche-rail";
import { tranchesOf } from "@/components/instruments/tranche";
import { fmtDateTime, shortAddress } from "@/lib/format";
import type { DealView } from "@/lib/views";
import { requireSession } from "@/server/auth/guard";
import { ApiError } from "@/server/http";
import { buildDealView, buildDocumentViews } from "@/server/services/views";
import styles from "./dispute.module.css";

export const metadata: Metadata = { title: "Dispute" };

const DISPUTE_STATUS: Record<string, [ChipTone, string]> = {
  opening: ["awaiting", "Opening, awaiting ledger"],
  open: ["disputed", "Open"],
  resolved: ["confirmed", "Resolved"],
};

export default async function DisputePage({ params }: { params: Promise<{ id: string; ordinal: string }> }) {
  const { id, ordinal: rawOrdinal } = await params;
  const session = await requireSession();
  let deal: DealView;
  try {
    deal = await buildDealView(session, id);
  } catch (e) {
    if (e instanceof ApiError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const ordinal = /^\d+$/.test(rawOrdinal) ? Number(rawOrdinal) : -1;
  const m = deal.milestones.find((x) => x.ordinal === ordinal);
  if (!m) notFound();

  const code = deal.asset.code;
  const dispute = deal.disputes.find((d) => d.milestoneOrdinal === ordinal) ?? null;
  const docs = dispute ? await buildDocumentViews(id) : [];
  const resolverParticipant = deal.participants.find((p) => p.role === "resolver");
  const resolverAddress = dispute?.resolverAddress ?? resolverParticipant?.address ?? null;
  const resolverName = deal.participants.find((p) => p.address === resolverAddress)?.name ?? resolverParticipant?.name ?? "the named resolver";
  const openTx = deal.transactions.find((t) => t.kind === "dispute" && t.milestoneOrdinal === ordinal && t.txHash === dispute?.openTxHash);
  const resolveTx = deal.transactions.find((t) => t.kind === "resolve" && t.milestoneOrdinal === ordinal && t.status === "confirmed");
  const resolutionHash = dispute?.resolutionTxHash ?? resolveTx?.txHash ?? null;
  const rejectedResolves = deal.transactions.filter((t) => t.kind === "resolve" && t.milestoneOrdinal === ordinal && t.status === "rejected_in_simulation");
  const resolved = dispute?.status === "resolved" || m.chainStatus === "Resolved";
  const isResolver = deal.myRoles.includes("resolver");
  const canResolve = isResolver && Boolean(m.gate?.allowed.includes("resolve_dispute"));
  const buyerName = deal.terms.buyer.legalName;
  const [statusTone, statusLabel] = DISPUTE_STATUS[dispute?.status ?? ""] ?? ["neutral", dispute?.status ?? "none"];
  const tranches = tranchesOf(deal.milestones);

  const whyNotResolve = !isResolver
    ? `Only the named resolver, ${resolverName}, can split the frozen amount. No administrator override.`
    : (m.gate?.blockedReasons.resolve_dispute ?? (dispute?.status === "opening" ? "The dispute transaction is awaiting ledger confirmation." : "The last ledger read doesn't show this milestone as disputed."));

  return (
    <>
      {deal.isSample ? <p className="sample-banner">Sample deal · synthetic parties · real {deal.network.label} transactions · {code} is a demo token</p> : null}

      <header className={styles.head}>
        <div>
          <p className={styles.ref}>
            {deal.reference}
            <span>/</span>
            M{ordinal + 1}
          </p>
          <h1 className={styles.title}>Dispute: {m.name}</h1>
          <div className={styles.meta}>
            {dispute ? <Chip tone={statusTone}>{statusLabel}</Chip> : null}
            {m.gate ? <MilestonePhaseChip phase={m.gate.phase} /> : null}
            <span>{deal.title}</span>
            <span className="tiny faint">You: {deal.myRoles.join(", ")}</span>
          </div>
        </div>
        <nav className="btn-group" aria-label="Agreement views">
          <Link className="btn" href={`/deals/${deal.id}`}>
            <ArrowLeft aria-hidden />
            Agreement
          </Link>
          <Link className="btn" href={`/deals/${deal.id}/settlement`}>
            <Receipt aria-hidden />
            Settlement
          </Link>
        </nav>
      </header>

      {!dispute ? (
        <div className="panel">
          <p className="empty">
            <strong>No dispute on this milestone</strong>
            The buyer or supplier can open one from the milestone card while funds are unreleased.{" "}
            <Link className="ext" href={`/deals/${deal.id}`}>
              Back to agreement
            </Link>
          </p>
        </div>
      ) : (
        <>
          <section className={`${styles.hero} ${resolved ? styles.heroResolved : ""}`} aria-label={resolved ? "Resolved tranche" : "Frozen tranche"}>
            <div className={styles.frozen}>
              <span className={styles.state}>
                {resolved ? <CheckCircle weight="fill" aria-hidden /> : <Scales weight="fill" aria-hidden />}
                {resolved ? "Resolved on-chain" : "Frozen"}
              </span>
              <span className={styles.frozenFigure}>
                <Figure units={m.amount} code={code} size="xl" />
              </span>
              <span className={styles.frozenWhat}>
                M{ordinal + 1} · {m.name} · payee {m.payeeName}
              </span>
            </div>
            <div className={styles.context}>
              <span className="eyebrow">Escrow by tranche</span>
              <TrancheRail tranches={tranches} size="thick" labels legend />
              <p className={styles.scope}>{resolved ? "Settled by the resolver's split. Plimsoll can't reopen it." : "The freeze covers this tranche only. Funds leave only through the resolver's signed split."}</p>
            </div>
            <div className={styles.resolver}>
              <span className="eyebrow">Resolver</span>
              <strong>{resolverName}</strong>
              {resolverAddress ? <Hash value={resolverAddress} label="resolver address" /> : null}
              <span className="tiny faint">Fixed at deployment · {deal.terms.disputeForum}</span>
            </div>
          </section>

          <div className="grid-cockpit">
            <div className="stack">
              <section className="panel" aria-labelledby="statements-title">
                <div className="panel-head">
                  <h2 id="statements-title" style={{ fontSize: 15 }}>
                    Record
                  </h2>
                  <span className="tiny faint">
                    {dispute.statements.length} statement{dispute.statements.length === 1 ? "" : "s"} · oldest first
                  </span>
                </div>
                <ol className={styles.thread}>
                  <li className={`${styles.post} ${styles.claim}`}>
                    <div className={styles.postHead}>
                      <strong>{dispute.openedBy}</strong>
                      <span className={styles.postRole}>Claim</span>
                      <span className={styles.postTime}>{fmtDateTime(dispute.createdAt)}</span>
                    </div>
                    <p>{dispute.reason}</p>
                    <span className="tiny faint">Visible to the parties. Only its SHA-256 digest is on-chain.</span>
                  </li>
                  {dispute.statements.map((s) => (
                    <li key={s.id} className={styles.post}>
                      <div className={styles.postHead}>
                        <strong>{s.author}</strong>
                        <span className={styles.postRole}>{s.role}</span>
                        <span className={styles.postTime}>{fmtDateTime(s.createdAt)}</span>
                      </div>
                      <p>{s.body}</p>
                    </li>
                  ))}
                </ol>
                <div className={styles.compose}>
                  {dispute.statements.length === 0 ? <p className="tiny faint">No statements yet.</p> : null}
                  {resolved ? <p className="why-not">Resolved. The record is closed.</p> : <StatementForm dealId={deal.id} disputeId={dispute.id} />}
                </div>
              </section>

              <section className="panel" aria-labelledby="evidence-title">
                <div className="panel-head">
                  <h2 id="evidence-title" style={{ fontSize: 15 }}>
                    Documents on file
                  </h2>
                  <Link className="btn sm" href={`/deals/${deal.id}/documents`}>
                    <Files aria-hidden />
                    Compare
                  </Link>
                </div>
                <div className="panel-body flush table-scroll">
                  {docs.length === 0 ? (
                    <p className="empty">No documents uploaded.</p>
                  ) : (
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Document</th>
                          <th className="num">Version</th>
                          <th>SHA-256</th>
                          <th>Analysis</th>
                          <th>Original</th>
                        </tr>
                      </thead>
                      <tbody>
                        {docs.flatMap((d) =>
                          d.versions.map((v, i) => (
                            <tr key={v.id}>
                              <td className="small">
                                {documentTypeLabel(d.documentType)}
                                <div className="tiny faint">{i === 0 ? "Current" : "Superseded"}</div>
                              </td>
                              <td className="num">v{v.version}</td>
                              <td>
                                <Hash value={v.sha256} label={`SHA-256 of ${d.title} v${v.version}`} />
                              </td>
                              <td>
                                <AnalysisChip state={v.analysisState} />
                              </td>
                              <td>
                                <a className="ext" href={`/api/v1/deals/${deal.id}/documents/versions/${v.id}/file`} target="_blank" rel="noreferrer">
                                  {v.fileName}
                                </a>
                              </td>
                            </tr>
                          )),
                        )}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>
            </div>

            <aside className="stack" aria-label="Resolution">
              <section className={`panel ${styles.decision}`} aria-labelledby="decision-title">
                <div className="panel-head">
                  <h2 id="decision-title" style={{ fontSize: 15 }}>
                    {resolved ? "Signed resolution" : "Resolver decision"}
                  </h2>
                  <span className="tiny faint mono">{code}</span>
                </div>
                <div className="panel-body stack" style={{ gap: 14 }}>
                  {resolved ? (
                    <>
                      {dispute.resolution ? (
                        <>
                          <SplitBar total={BigInt(m.amount)} code={code} buyer={{ name: buyerName, units: BigInt(dispute.resolution.toBuyer) }} payee={{ name: m.payeeName, units: BigInt(dispute.resolution.toPayee) }} />
                          <div>
                            <p className="eyebrow">Rationale</p>
                            <p className="small" style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>
                              {dispute.resolution.rationale}
                            </p>
                          </div>
                        </>
                      ) : (
                        <p className="small muted">The ledger shows this milestone resolved. Split details aren&apos;t recorded here yet.</p>
                      )}
                      <dl className="kv">
                        <dt>Signed by</dt>
                        <dd className="small">{resolverName}</dd>
                        <dt>Transaction</dt>
                        <dd>
                          {resolutionHash ? (
                            <>
                              <Hash value={resolutionHash} href={resolveTx?.explorerUrl} label="resolution transaction" /> {resolveTx?.ledger ? <span className="tiny faint mono">ledger {resolveTx.ledger}</span> : <span className="tiny faint">awaiting ledger</span>}
                            </>
                          ) : (
                            <span className="faint">Not recorded</span>
                          )}
                        </dd>
                        <dt>Escrow state</dt>
                        <dd className="small">
                          {m.chainStatus ?? "Unknown"}
                          {deal.chain ? ` at ledger ${deal.chain.ledger}` : ""}
                        </dd>
                      </dl>
                    </>
                  ) : canResolve ? (
                    <ResolutionForm
                      dealId={deal.id}
                      milestoneOrdinal={ordinal}
                      amount={m.amount}
                      assetCode={code}
                      networkLabel={deal.network.label}
                      buyer={{ name: buyerName, address: deal.terms.buyer.address }}
                      payee={{ name: m.payeeName, address: m.payee }}
                    />
                  ) : (
                    <>
                      <SplitBar total={BigInt(m.amount)} code={code} buyer={{ name: buyerName, units: 0n }} payee={{ name: m.payeeName, units: 0n }} />
                      <p className="small muted">Waits for {resolverName}&apos;s signed split.</p>
                      <p className="why-not">{whyNotResolve}</p>
                    </>
                  )}
                  {rejectedResolves.map((t) => (
                    <p key={t.id} className={styles.rejected}>
                      Contract rejected: <span className="mono">{t.errorCode ?? "unknown"}</span> <span className="tiny faint">{fmtDateTime(t.createdAt)}</span>
                    </p>
                  ))}
                </div>
              </section>

              <section className="panel" aria-labelledby="proof-title">
                <div className="panel-head">
                  <h2 id="proof-title" style={{ fontSize: 15 }}>
                    Chain proof
                  </h2>
                </div>
                <div className="panel-body">
                  <dl className="kv">
                    <dt>Reason digest</dt>
                    <dd>
                      <Hash value={dispute.reasonDigest} label="reason digest" />
                    </dd>
                    <dt>Opened</dt>
                    <dd>
                      {dispute.openTxHash ? (
                        <>
                          <Hash value={dispute.openTxHash} href={openTx?.explorerUrl} label="dispute transaction" />
                          <span className="tiny faint mono" style={{ display: "block" }}>
                            {openTx?.ledger ? `ledger ${openTx.ledger}` : "awaiting ledger"}
                          </span>
                        </>
                      ) : (
                        <span className="faint">Not submitted</span>
                      )}
                    </dd>
                    <dt>Resolved</dt>
                    <dd>{resolutionHash ? <Hash value={resolutionHash} href={resolveTx?.explorerUrl} label="resolution transaction" /> : <span className="faint">Not yet</span>}</dd>
                    <dt>Escrow</dt>
                    <dd>{deal.chain ? <Hash value={deal.chain.contractId} href={deal.chain.contractExplorerUrl} label="escrow contract" /> : <span className="faint">Not deployed</span>}</dd>
                  </dl>
                </div>
              </section>

              <section className="panel" aria-labelledby="participants-title">
                <div className="panel-head">
                  <h2 id="participants-title" style={{ fontSize: 15 }}>
                    Parties
                  </h2>
                </div>
                <div>
                  {deal.participants.map((p) => (
                    <div key={`${p.role}-${p.address}`} className={styles.party}>
                      <span className={styles.role}>{p.role}</span>
                      <span className={styles.partyName}>
                        <span>{p.name}</span>
                        {p.isMe ? <span className={styles.you}>YOU</span> : null}
                      </span>
                      <span className="mono tiny faint">{p.address ? shortAddress(p.address) : p.status}</span>
                    </div>
                  ))}
                </div>
              </section>
            </aside>
          </div>
        </>
      )}
    </>
  );
}
