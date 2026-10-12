import { ArrowLeft, CheckCircle, Fingerprint, Receipt, WarningOctagon } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AnalysisPoller } from "@/components/documents/analysis-poller";
import { isAnalysing } from "@/components/documents/status";
import { VersionHistory } from "@/components/documents/version-history";
import { DocumentWorkspace } from "@/components/documents/workspace";
import { Figure } from "@/components/instruments/figure";
import { TrancheRail } from "@/components/instruments/tranche-rail";
import { tranchesOf } from "@/components/instruments/tranche";
import { LiveRefresh } from "@/components/live-refresh";
import { chainInFlight } from "@/lib/in-flight";
import type { DealView } from "@/lib/views";
import { requireSession } from "@/server/auth/guard";
import { ApiError } from "@/server/http";
import { buildDealView, buildDiscrepancyViews, buildDocumentViews } from "@/server/services/views";
import styles from "./documents-page.module.css";

export const metadata: Metadata = { title: "Documents" };

const SETTLED = new Set(["Released", "Resolved", "Refunded"]);

export default async function DealDocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  let deal: DealView;
  try {
    deal = await buildDealView(session, id);
  } catch (e) {
    if (e instanceof ApiError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const [docs, findings] = await Promise.all([buildDocumentViews(id), buildDiscrepancyViews(id)]);
  const inFlight = docs.flatMap((d) => d.versions).filter((v) => isAnalysing(v.analysisState)).length;
  const { total, analyzed, openBlocking, openWarnings } = deal.documentsSummary;
  const code = deal.asset.code;
  const tranches = tranchesOf(deal.milestones);
  const held = deal.milestones.filter((m) => m.openBlockingFindings > 0 && !(m.chainStatus !== null && SETTLED.has(m.chainStatus)));
  const heldUnits = held.reduce((a, m) => a + BigInt(m.amount), 0n);

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
          <h1 className={styles.title}>Document comparison</h1>
          <div className={styles.meta}>
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

      <section className={styles.strip} aria-label="Document position">
        <dl className={styles.stats}>
          <div>
            <dt>Received</dt>
            <dd>{total}</dd>
          </div>
          <div>
            <dt>Analysed</dt>
            <dd>
              {analyzed}
              <span>/{total}</span>
            </dd>
          </div>
          <div className={openBlocking > 0 ? styles.bad : ""}>
            <dt>Blocking</dt>
            <dd>{openBlocking}</dd>
          </div>
          <div>
            <dt>Warnings</dt>
            <dd>{openWarnings}</dd>
          </div>
        </dl>
        <div className={styles.hold}>
          <div className={styles.holdHead}>
            {held.length > 0 ? (
              <>
                <span className={styles.holdLabel}>
                  <WarningOctagon weight="fill" aria-hidden />
                  Held by mismatch · {held.map((m) => `M${m.ordinal + 1}`).join(", ")}
                </span>
                <span className={styles.heldFigure}>
                  <Figure units={heldUnits} code={code} size="md" />
                </span>
              </>
            ) : (
              <span className={styles.clearLabel}>
                <CheckCircle weight="fill" aria-hidden />
                No money held by documents
              </span>
            )}
          </div>
          <TrancheRail tranches={tranches} legend />
        </div>
      </section>

      <p className={styles.proof}>
        <Fingerprint aria-hidden />
        Hashes prove which version was reviewed, not that it is genuine. Rules set severity. Only a new version or a recorded decision clears a finding.
      </p>

      <AnalysisPoller inFlight={inFlight} />
      <LiveRefresh active={chainInFlight(deal)} ledgerReadAt={deal.chain?.syncedAt ?? null} />

      <DocumentWorkspace dealId={deal.id} docs={docs} findings={findings} milestones={deal.milestones} myRoles={deal.myRoles} termsVersion={deal.version} />

      <section className="panel" style={{ marginTop: 20 }} aria-labelledby="versions-title">
        <div className="panel-head">
          <h2 id="versions-title" style={{ fontSize: 15 }}>
            Version history
          </h2>
          <span className="tiny faint">Originals are never overwritten</span>
        </div>
        <div className="panel-body flush">
          <VersionHistory dealId={deal.id} docs={docs} />
        </div>
      </section>
    </>
  );
}
