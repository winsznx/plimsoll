import { ArrowRight, SealCheck, SealWarning } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CONTRACT_ERRORS, DOCUMENT_TYPE_LABELS } from "@plimsoll/domain";
import { Chip, type ChipTone } from "@/components/chip";
import { Hash } from "@/components/hash";
import { Figure } from "@/components/instruments/figure";
import { LoadLineGauge } from "@/components/instruments/load-line-gauge";
import { TrancheRail } from "@/components/instruments/tranche-rail";
import type { Tranche, TrancheState } from "@/components/instruments/tranche";
import { PublicFooter, PublicHeader } from "@/components/public/public-frame";
import { fmtDateTime, shortAddress } from "@/lib/format";
import { optionalSession } from "@/server/auth/guard";
import { ApiError } from "@/server/http";
import { deploymentProof, networkBadge } from "@/server/services/landing";
import { publicProof, type PublicProof } from "@/server/services/verify";
import { EvidenceChecker } from "./evidence-checker";
import styles from "./verify.module.css";

export const metadata: Metadata = { title: "Public proof" };

const AGREEMENT_TONES: Record<string, ChipTone> = {
  AwaitingAcceptance: "awaiting",
  AwaitingFunding: "awaiting",
  Funded: "attention",
  Completed: "confirmed",
  Cancelled: "neutral",
};

const MILESTONE_TONES: Record<string, ChipTone> = {
  Open: "awaiting",
  Disputed: "disputed",
  Released: "confirmed",
  Resolved: "confirmed",
  Refunded: "confirmed",
};

const TX_LABELS: Record<string, string> = {
  deploy: "Deploy escrow",
  accept: "Accept terms",
  fund: "Fund escrow",
  anchor: "Anchor evidence",
  approve: "Approve milestone",
  revoke: "Revoke approval",
  release: "Release milestone",
  dispute: "Open dispute",
  resolve: "Resolve dispute",
  refund: "Refund milestone",
  cancel: "Cancel agreement",
  ttl: "Extend storage",
};

const MONEY_KINDS = new Set(["fund", "release", "refund", "resolve"]);

function contractErrorExplanation(code: string | null): string | null {
  if (!code) return null;
  return Object.values(CONTRACT_ERRORS).find((e) => e.code === code)?.explanation ?? null;
}

function docLabel(type: string): string {
  const labels: Record<string, string | undefined> = DOCUMENT_TYPE_LABELS;
  return labels[type] ?? type;
}

function splitWords(status: string): string {
  return status.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/** The public page sees only chain status, not gates or findings, so an open tranche reads as waiting. */
function chainTrancheState(status: string | null): TrancheState {
  if (status === "Released" || status === "Resolved") return "released";
  if (status === "Refunded") return "refunded";
  if (status === "Disputed") return "disputed";
  return "waiting";
}

export default async function VerifyPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const session = await optionalSession();
  let proof: PublicProof;
  try {
    proof = await publicProof(ref);
  } catch (e) {
    if (e instanceof ApiError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const c = proof.chain;
  const code = proof.asset.code;
  const anchored = proof.milestones.flatMap((m) => (m.evidenceManifest ? [{ ...m, manifest: m.evidenceManifest }] : []));
  const deployment = deploymentProof();
  const isDemo = deployment !== null && deployment.tokenContractId === proof.asset.contractId && deployment.assetIsDemo;
  const tranches: Tranche[] = proof.milestones.map((m) => ({ ordinal: m.ordinal, name: m.name, amount: BigInt(m.amount), state: chainTrancheState(m.status) }));

  return (
    <>
      <PublicHeader signedIn={session !== null} networkLabel={networkBadge()} />
      <main id="main" className={styles.work}>
        {proof.isSample ? <p className="sample-banner">Sample deal · synthetic parties and documents · real {proof.network} transactions · {code} is a demo token</p> : null}

        <header className={styles.head}>
          <p className={styles.ref}>
            Public proof<span>/</span>
            {proof.reference}
          </p>
          <h1 className={styles.title}>Escrow record for {proof.reference}</h1>
          <div className={styles.meta}>
            {c ? <Chip tone={AGREEMENT_TONES[c.status] ?? "neutral"}>{splitWords(c.status)}</Chip> : <Chip tone="awaiting">Not read yet</Chip>}
            <span>
              {proof.parties.buyer} <ArrowRight aria-label="to" /> {proof.parties.supplier}
            </span>
            <span className="tiny faint">Read from the contract. Every identifier links to a public explorer.</span>
          </div>
        </header>

        <section className={styles.hero} aria-label="Escrow position">
          <div className={styles.gauge}>
            <LoadLineGauge tranches={tranches} funded={BigInt(c?.funded ?? "0")} total={BigInt(proof.total)} code={code} />
          </div>

          <div className={styles.readout}>
            <div>
              <span className="eyebrow">In escrow</span>
              <div style={{ marginTop: 10 }}>{c ? <Figure units={c.balance} code={code} size="xl" /> : <span className="hero-amount faint">Not read</span>}</div>
            </div>
            <dl className={styles.stats}>
              <div>
                <dt>Total</dt>
                <dd>
                  <Figure units={proof.total} size="sm" />
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
              <p className={c.conservationHolds ? styles.balanced : styles.unbalanced} role="status">
                {c.conservationHolds ? <SealCheck weight="fill" aria-hidden /> : <SealWarning weight="fill" aria-hidden />}
                <span>
                  <strong>{c.conservationHolds ? "Conservation check holds." : "Conservation check failed."}</strong> {c.conservationHolds ? "Funded = released + refunded + balance" : "Funded does not equal released + refunded + balance"}, at ledger <span className="mono">{c.ledger}</span>.
                </span>
              </p>
            ) : (
              <p className="tiny muted">Chain state not read yet.</p>
            )}
          </div>

          <dl className={styles.ids}>
            <div>
              <dt>Escrow contract</dt>
              <dd>
                <Hash value={proof.contractId} href={proof.contractExplorerUrl} label="escrow contract" />
              </dd>
            </div>
            <div>
              <dt>Terms digest</dt>
              <dd>{proof.termsDigest ? <Hash value={proof.termsDigest} label="terms digest" /> : <span className="faint">Not frozen</span>}</dd>
            </div>
            <div>
              <dt>{code} token</dt>
              <dd>
                <Hash value={proof.asset.contractId} label="token contract" />
                {isDemo ? <span className={styles.note}>Demo token, not USDC</span> : null}
              </dd>
            </div>
            <div>
              <dt>Last read</dt>
              <dd className="mono tiny">{c ? `Ledger ${c.ledger} · ${fmtDateTime(c.readAt)}` : "Not read yet"}</dd>
            </div>
          </dl>
        </section>

        <div className="grid-2">
          <div className={`stack ${styles.col}`}>
            <section className="panel" aria-labelledby="milestones-title">
              <div className="panel-head">
                <h2 id="milestones-title" className={styles.panelTitle}>
                  Milestones
                </h2>
                <span className="tiny faint mono">Evidence digests as stored on chain</span>
              </div>
              <div className="panel-body flush table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Milestone</th>
                      <th className="num">Amount</th>
                      <th>Signed</th>
                      <th>Status</th>
                      <th>Evidence digest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proof.milestones.map((m) => (
                      <tr key={m.ordinal}>
                        <td>
                          <span className={styles.ordinal}>M{m.ordinal + 1}</span> {m.name}
                        </td>
                        <td className="num">
                          <Figure units={m.amount} size="sm" />
                        </td>
                        <td className="mono small">
                          {m.approvals}/{m.quorum}
                        </td>
                        <td>{m.status ? <Chip tone={MILESTONE_TONES[m.status] ?? "neutral"}>{m.status}</Chip> : <span className="small faint">Not on chain</span>}</td>
                        <td>{m.evidenceDigest ? <Hash value={m.evidenceDigest} label={`milestone ${m.ordinal + 1} evidence digest`} /> : <span className="small faint">Not anchored</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="panel" aria-labelledby="tx-title">
              <div className="panel-head">
                <h2 id="tx-title" className={styles.panelTitle}>
                  Transactions
                </h2>
                <span className="tiny faint mono">Newest first · includes refused attempts</span>
              </div>
              <div className="panel-body flush table-scroll">
                {proof.transactions.length === 0 ? (
                  <p className="empty">No transactions recorded.</p>
                ) : (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Action</th>
                        <th>Result</th>
                        <th className="num">Amount</th>
                        <th className="num">Ledger</th>
                        <th>Transaction</th>
                      </tr>
                    </thead>
                    <tbody>
                      {proof.transactions.map((t, i) => {
                        const rejected = t.status === "rejected_in_simulation";
                        const why = contractErrorExplanation(t.errorCode);
                        return (
                          <tr key={t.txHash ?? `${t.kind}-${t.at}-${i}`}>
                            <td style={{ minWidth: 170 }}>
                              {TX_LABELS[t.kind] ?? t.kind}
                              {t.milestoneOrdinal !== null ? <span className="muted"> · M{t.milestoneOrdinal + 1}</span> : null}
                              <div className="tiny faint mono">{fmtDateTime(t.at)}</div>
                            </td>
                            <td>
                              {rejected ? (
                                <>
                                  <Chip tone="blocked">Refused</Chip>
                                  {t.errorCode ? <div className="tiny mono" style={{ marginTop: 4 }}>{t.errorCode}</div> : null}
                                  {why ? <div className="tiny muted">{why}</div> : null}
                                </>
                              ) : (
                                <Chip tone="confirmed">Confirmed</Chip>
                              )}
                            </td>
                            <td className="num">{t.amount && !rejected && MONEY_KINDS.has(t.kind) ? <Figure units={t.amount} size="sm" /> : null}</td>
                            <td className="num">{t.ledger ?? ""}</td>
                            <td style={{ whiteSpace: "nowrap" }}>{t.txHash ? <Hash value={t.txHash} href={t.explorerUrl} label="transaction" /> : <span className="tiny faint">{rejected ? "Never submitted" : "Pending"}</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          </div>

          <aside className={`stack ${styles.col}`} aria-label="Chain identity">
            <section className="panel" aria-labelledby="chain-title">
              <div className="panel-head">
                <h2 id="chain-title" className={styles.panelTitle}>
                  Chain identity
                </h2>
              </div>
              <div className="panel-body">
                <dl className="kv">
                  <dt>Network</dt>
                  <dd>{proof.network}</dd>
                  <dt>Passphrase</dt>
                  <dd className="mono tiny">{proof.passphrase}</dd>
                  <dt>Asset</dt>
                  <dd>
                    {code}
                    {isDemo ? <span className="tiny muted"> · demo token</span> : null}
                  </dd>
                  <dt>Issuer</dt>
                  <dd className="mono tiny" title={proof.asset.issuer}>
                    {shortAddress(proof.asset.issuer, 6, 6)}
                  </dd>
                </dl>
              </div>
            </section>

            <section className="panel" aria-labelledby="parties-title">
              <div className="panel-head">
                <h2 id="parties-title" className={styles.panelTitle}>
                  Parties
                </h2>
              </div>
              <div className="panel-body">
                <dl className="kv">
                  <dt>Buyer</dt>
                  <dd>{proof.parties.buyer}</dd>
                  <dt>Supplier</dt>
                  <dd>{proof.parties.supplier}</dd>
                </dl>
                <p className="tiny faint" style={{ marginTop: 12 }}>
                  Names as written in the terms. A name is not identity verification.
                </p>
              </div>
            </section>
          </aside>
        </div>

        <section className="panel" aria-labelledby="manifest-title" style={{ marginTop: 20 }}>
          <div className="panel-head">
            <h2 id="manifest-title" className={styles.panelTitle}>
              Evidence manifests
            </h2>
            <span className="tiny faint mono">Reviewer reasons redacted</span>
          </div>
          {anchored.length === 0 ? (
            <p className="empty">
              <strong>No evidence anchored yet</strong>
              Manifests appear once a milestone&apos;s evidence is anchored.
            </p>
          ) : (
            anchored.map(({ manifest, ...m }) => (
              <div key={m.ordinal} className={styles.manifest}>
                <div className={styles.manifestHead}>
                  <h3>
                    <span className={styles.ordinal}>M{m.ordinal + 1}</span> {m.name}
                  </h3>
                  <p className={styles.manifestMeta}>
                    {manifest.schema} · agreement {manifest.agreementDigest.slice(0, 12)}…
                  </p>
                </div>
                {manifest.documents.length === 0 ? (
                  <p className="small muted" style={{ padding: "0 18px 16px" }}>
                    No documents. The digest commits to the agreement digest{manifest.findings.length + manifest.attestations.length > 0 ? " and the decisions below" : ""}.
                  </p>
                ) : (
                  <div className="table-scroll">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Document</th>
                          <th className="num">Version</th>
                          <th>SHA-256</th>
                        </tr>
                      </thead>
                      <tbody>
                        {manifest.documents.map((d) => (
                          <tr key={d.versionId}>
                            <td>{docLabel(d.documentType)}</td>
                            <td className="num">v{d.version}</td>
                            <td>
                              <Hash value={d.sha256} label={`${docLabel(d.documentType)} hash`} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {manifest.findings.length > 0 ? (
                  <div className={styles.manifestList}>
                    <p className="eyebrow">Finding decisions</p>
                    <ul className="consequences">
                      {manifest.findings.map((f) => (
                        <li key={f.fingerprint}>
                          <span className="mono tiny">{f.ruleId}</span> {f.state.replaceAll("_", " ")} <span className="faint">· reason {f.reason}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {manifest.attestations.length > 0 ? (
                  <div className={styles.manifestList}>
                    <p className="eyebrow">Attestations</p>
                    <ul className="consequences">
                      {manifest.attestations.map((a) => (
                        <li key={a.digest}>
                          {a.statement} <span className="mono tiny faint">· {shortAddress(a.signer)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </section>

        <div style={{ marginTop: 20 }}>
          <EvidenceChecker milestones={proof.milestones.map((m) => ({ ordinal: m.ordinal, name: m.name, evidenceDigest: m.evidenceDigest, manifest: m.evidenceManifest }))} />
        </div>
      </main>
      <PublicFooter />
    </>
  );
}
