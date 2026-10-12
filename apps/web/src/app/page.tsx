import { CheckCircle, FileText, LockSimple, Seal, Signature, WarningOctagon } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Hash } from "@/components/hash";
import { AccountPath } from "@/components/instruments/account-path";
import { Figure } from "@/components/instruments/figure";
import { TrancheRail } from "@/components/instruments/tranche-rail";
import type { Tranche } from "@/components/instruments/tranche";
import { LandingReplay } from "@/components/public/landing-replay";
import { PublicFooter, PublicHeader } from "@/components/public/public-frame";
import { SAMPLE_CODE, SAMPLE_MILESTONES, SAMPLE_TOTAL } from "@/components/public/sample-deal";
import { fmtDateTime } from "@/lib/format";
import { optionalSession } from "@/server/auth/guard";
import { deploymentProof, networkBadge, sampleReplay, type SampleReplay } from "@/server/services/landing";
import styles from "./landing.module.css";

export const metadata: Metadata = {
  title: { absolute: "Plimsoll · Trade agreements that know when to pay" },
};

const PLAN_STATES = ["released", "eligible", "waiting"] as const;
const PLAN: Tranche[] = SAMPLE_MILESTONES.map((m, i) => ({ ordinal: m.ordinal, name: m.name, amount: m.amount, state: PLAN_STATES[i] ?? "waiting" }));
const HELD_TRANCHE = SAMPLE_MILESTONES[1];

const LOCKS: { title: string; body: string; icon: ReactNode; state: "open" | "shut" | "locked" }[] = [
  { title: "Documents", body: "3 of 3 received", icon: <FileText aria-hidden />, state: "open" },
  { title: "Findings", body: "1 blocking mismatch", icon: <WarningOctagon aria-hidden />, state: "shut" },
  { title: "Evidence", body: "Anchors once findings clear", icon: <Seal aria-hidden />, state: "locked" },
  { title: "Approvals", body: "0 of 2 · Buyer, Inspector", icon: <Signature aria-hidden />, state: "locked" },
];

const PACKING = [
  { sku: "KC-TILE-60", invoice: "320 ctn", packing: "320 ctn", hit: false },
  { sku: "KC-TILE-30", invoice: "160 ctn", packing: "148 ctn", hit: true },
] as const;

function limits(assetCode: string): [string, string][] {
  return [
    ["Testnet only", "No real money. The contract is not audited."],
    ["Demo token", `${assetCode} has no value and is not USDC.`],
    ["Escrow, not credit", "Not a letter of credit, guarantee or insurance."],
    ["No AI custody", "Document checks suggest findings. People sign."],
    ["No title transfer", "A bill of lading hash does not move title."],
  ];
}

function SessionTape({ replay, network }: { replay: SampleReplay; network: string }) {
  const chain = replay.chain;
  return (
    <section className={`panel ${styles.session}`} aria-labelledby="replay-title">
      <div className="panel-head">
        <div>
          <h3 id="replay-title">Recorded testnet session</h3>
          <p className="sub">
            {replay.reference} · {replay.buyer} to {replay.supplier}
          </p>
        </div>
      </div>
      {replay.entries.length === 0 ? (
        <p className="empty">Deployed. No confirmed transactions yet.</p>
      ) : (
        <ol className={styles.tape} aria-label={`Ledger events for ${replay.reference}, oldest first`}>
          {replay.entries.map((e) =>
            e.kind === "finding" ? (
              <li key={`f-${e.at}-${e.label}`} className={`${styles.entry} ${styles.finding}`}>
                <span className={styles.ledger}>open</span>
                <span className={styles.entryLabel}>
                  {e.label}
                  <span className={styles.entryMeta}>
                    {e.detail ?? "Blocking document finding"} Flagged {fmtDateTime(e.at)}.
                  </span>
                </span>
                <span className={styles.heldMark}>
                  <WarningOctagon weight="fill" aria-hidden />
                  Held
                </span>
              </li>
            ) : (
              <li key={e.txHash ?? `${e.kind}-${e.at}`} className={styles.entry}>
                <span className={styles.ledger}>{e.ledger ?? "pending"}</span>
                <span className={styles.entryLabel}>
                  {e.label}
                  <span className={styles.entryMeta}>
                    {fmtDateTime(e.at)}
                    {e.txHash ? (
                      e.explorerUrl ? (
                        <a className="ext" href={e.explorerUrl} target="_blank" rel="noreferrer" aria-label={`Transaction ${e.txHash} on the explorer`}>
                          tx {e.txHash.slice(0, 10)}
                        </a>
                      ) : (
                        <span>tx {e.txHash.slice(0, 10)}</span>
                      )
                    ) : null}
                  </span>
                </span>
                <span className={styles.amount}>{e.amount ? <Figure units={e.amount} size="sm" /> : null}</span>
              </li>
            ),
          )}
        </ol>
      )}
      <div className={styles.sessionFoot}>
        <dl className={styles.sessionStats}>
          <div>
            <dt>In escrow</dt>
            <dd>{chain ? <Figure units={chain.balance} code={replay.assetCode} size="sm" /> : <span className="faint">Not read</span>}</dd>
          </div>
          <div>
            <dt>Released</dt>
            <dd>{chain ? <Figure units={chain.released} code={replay.assetCode} size="sm" /> : <span className="faint">Not read</span>}</dd>
          </div>
        </dl>
        <p className="tiny faint">{chain ? `${network} · ledger ${chain.ledger} · ${fmtDateTime(chain.readAt)}` : network}. Synthetic parties, real transactions.</p>
        <div className={styles.sessionLinks}>
          <Link className="ext" href={`/verify/${replay.publicRef}`}>
            Check the public proof
          </Link>
          {replay.contractExplorerUrl ? (
            <a className="ext" href={replay.contractExplorerUrl} target="_blank" rel="noreferrer">
              Contract on explorer
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export default async function LandingPage() {
  const [session, replay] = await Promise.all([optionalSession(), sampleReplay()]);
  const proof = deploymentProof();
  const networkLabel = proof?.network ?? "Stellar testnet";
  const assetCode = proof?.assetCode ?? replay?.assetCode ?? SAMPLE_CODE;

  return (
    <>
      <PublicHeader signedIn={session !== null} networkLabel={networkBadge()} />
      <main id="main">
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={`${styles.wrap} ${styles.heroGrid}`}>
            <div className={styles.pitch}>
              <h1 id="hero-title" className={styles.headline}>
                Trade agreements that know when to pay.
              </h1>
              <p className={styles.lede}>Escrow for B2B goods on Stellar. Each tranche pays out only when the documents reconcile and the named approvers sign.</p>
              <div className={styles.ctas}>
                <Link className="btn primary" href="/sign-in">
                  Try the demo
                </Link>
                {replay ? (
                  <Link className="btn" href={`/verify/${replay.publicRef}`}>
                    Check the public proof
                  </Link>
                ) : null}
              </div>
            </div>
            <LandingReplay />
          </div>
        </section>

        <section className={styles.section} aria-labelledby="money-title">
          <div className={styles.wrap}>
            <h2 id="money-title" className={styles.title}>
              Money moves by milestone.
            </h2>
            <p className={styles.sub}>The buyer funds once. Each tranche has its own release condition.</p>

            <div className={styles.fund}>
              <AccountPath from="Buyer" to="Escrow" held />
              <Figure units={SAMPLE_TOTAL} code={SAMPLE_CODE} size="lg" />
              <span className="small muted">Funded in full before the goods ship.</span>
            </div>
            <TrancheRail tranches={PLAN} size="thick" labels legend />
            <ol className={styles.split} style={{ gridTemplateColumns: SAMPLE_MILESTONES.map((m) => `minmax(0, ${m.share}fr)`).join(" ") }}>
              {SAMPLE_MILESTONES.map((m) => (
                <li key={m.ordinal}>
                  <span className={styles.splitRef}>
                    M{m.ordinal + 1} · {m.share}%
                  </span>
                  <h3>{m.name}</h3>
                  <p>{m.condition}</p>
                  <AccountPath from="Escrow" to="Supplier" />
                  <span className={styles.signers}>Signs: {m.approvers}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="hold-title">
          <div className={styles.wrap}>
            <h2 id="hold-title" className={styles.title}>
              A mismatch holds the money.
            </h2>
            <p className={styles.sub}>Documents are checked against each other. Release unlocks only when every lock is open.</p>

            <div className={styles.holdGrid}>
              <figure className={styles.compare}>
                <div className={styles.papers}>
                  <div className={styles.paper}>
                    <span className={styles.paperType}>Commercial invoice</span>
                    {PACKING.map((r) => (
                      <span key={r.sku} className={`${styles.line} ${r.hit ? styles.hit : styles.ok}`}>
                        <span>{r.sku}</span>
                        <strong>{r.invoice}</strong>
                      </span>
                    ))}
                  </div>
                  <div className={styles.paper}>
                    <span className={styles.paperType}>Packing list</span>
                    {PACKING.map((r) => (
                      <span key={r.sku} className={`${styles.line} ${r.hit ? styles.hit : styles.ok}`}>
                        <span>{r.sku}</span>
                        <strong>{r.packing}</strong>
                      </span>
                    ))}
                  </div>
                </div>
                <figcaption className={styles.alert}>
                  <WarningOctagon weight="fill" aria-hidden />
                  <span className="grow">1 blocking mismatch holds {HELD_TRANCHE.name}.</span>
                  <Figure units={HELD_TRANCHE.amount} size="sm" />
                </figcaption>
              </figure>

              <ul className={styles.locks} aria-label={`Release locks for ${HELD_TRANCHE.name}`}>
                {LOCKS.map((l) => (
                  <li key={l.title} className={`${styles.lock} ${styles[l.state] ?? ""}`}>
                    <span className={styles.lockIcon}>{l.icon}</span>
                    <span className={styles.lockTitle}>{l.title}</span>
                    <span className={styles.lockBody}>{l.body}</span>
                    <span className={styles.lockState}>{l.state === "open" ? <CheckCircle weight="fill" aria-label="Open" /> : <LockSimple weight="fill" aria-label="Locked" />}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="proof-title">
          <div className={styles.wrap}>
            <h2 id="proof-title" className={styles.title}>
              Every move is on the ledger.
            </h2>
            <p className={styles.sub}>Real testnet transactions from the sample deal. Check any of them on the explorer.</p>

            <div className={styles.proofGrid}>
              {replay ? (
                <SessionTape replay={replay} network={networkLabel} />
              ) : (
                <section className={`panel ${styles.session}`} aria-labelledby="replay-title">
                  <div className="panel-head">
                    <h3 id="replay-title">Recorded testnet session</h3>
                  </div>
                  <p className="empty">The sample deal is not deployed on {networkLabel} yet.</p>
                </section>
              )}

              <div className="stack">
                <section className="panel" aria-labelledby="deploy-title">
                  <div className="panel-head">
                    <h3 id="deploy-title">Deployment proof</h3>
                  </div>
                  {proof ? (
                    <dl className={styles.ids}>
                      <dt>Network</dt>
                      <dd>
                        {proof.network}
                        <span className={styles.passphrase}>{proof.passphrase}</span>
                      </dd>
                      <dt>Escrow wasm</dt>
                      <dd>
                        <Hash value={proof.wasmHash} label="escrow wasm hash" />
                      </dd>
                      <dt>{proof.assetCode}</dt>
                      <dd>
                        <Hash value={proof.tokenContractId} href={proof.tokenExplorerUrl} label="token contract" />
                      </dd>
                      <dt>Proof page</dt>
                      <dd>
                        {replay ? (
                          <Link className="ext mono tiny" href={`/verify/${replay.publicRef}`}>
                            /verify/{replay.publicRef}
                          </Link>
                        ) : (
                          <span className="faint">After the sample deploys</span>
                        )}
                      </dd>
                    </dl>
                  ) : (
                    <p className="empty">Chain identifiers appear once testnet is bootstrapped.</p>
                  )}
                </section>

                <section className="panel" id="limits" aria-labelledby="limits-title">
                  <div className="panel-head">
                    <h3 id="limits-title">Limits</h3>
                  </div>
                  <dl className={styles.limits}>
                    {limits(assetCode).map(([term, detail]) => (
                      <div key={term}>
                        <dt>{term}</dt>
                        <dd>{detail}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              </div>
            </div>
          </div>
        </section>
      </main>
      <PublicFooter />
    </>
  );
}
