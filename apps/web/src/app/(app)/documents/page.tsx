import { FileText, Files } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { DOCUMENT_TYPE_LABELS, type DocumentType } from "@plimsoll/domain";
import { Chip, type ChipTone } from "@/components/chip";
import { Hash } from "@/components/hash";
import { fmtDateTime } from "@/lib/format";
import type { DiscrepancyView, DocumentView } from "@/lib/views";
import { requireSession } from "@/server/auth/guard";
import { listDeals } from "@/server/services/deals";
import { buildDiscrepancyViews, buildDocumentViews } from "@/server/services/views";
import styles from "./documents.module.css";

export const metadata: Metadata = { title: "Documents" };

const ANALYSIS: Record<string, [ChipTone, string]> = {
  done: ["confirmed", "Analyzed"],
  processing: ["awaiting", "Analyzing"],
  queued: ["awaiting", "Queued"],
  failed: ["blocked", "Analysis failed"],
};

function typeLabel(type: string): string {
  return DOCUMENT_TYPE_LABELS[type as DocumentType] ?? type.replaceAll("_", " ");
}

function isOpen(d: DiscrepancyView): boolean {
  return d.active && (d.state === "open" || d.state === "correction_requested");
}

interface VaultRow {
  doc: DocumentView;
  dealId: string;
  reference: string;
  isSample: boolean;
  blocking: number;
  other: number;
}

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ deal?: string; type?: string }> }) {
  const { deal: dealFilter, type: typeFilter } = await searchParams;
  const session = await requireSession();
  const deals = await listDeals(session);

  const rows: VaultRow[] = [];
  for (const deal of deals) {
    const docs = await buildDocumentViews(deal.id);
    const open = (await buildDiscrepancyViews(deal.id)).filter(isOpen);
    for (const doc of docs) {
      const mine = open.filter((f) => f.expected.documentId === doc.id || f.actual.documentId === doc.id);
      rows.push({ doc, dealId: deal.id, reference: deal.reference, isSample: deal.isSample, blocking: mine.filter((f) => f.severity === "blocking").length, other: mine.filter((f) => f.severity !== "blocking").length });
    }
  }

  const types = [...new Set(rows.map((r) => r.doc.documentType))].sort();
  const shown = rows.filter((r) => (!dealFilter || r.dealId === dealFilter) && (!typeFilter || r.doc.documentType === typeFilter));
  const blockingTotal = shown.reduce((n, r) => n + r.blocking, 0);
  const filtered = Boolean(dealFilter || typeFilter);

  return (
    <>
      {rows.some((r) => r.isSample) ? <p className="sample-banner">Includes sample deals · synthetic parties · real testnet transactions</p> : null}
      <div className="page-head">
        <div>
          <h1>Documents</h1>
          <div className="sub">
            <span>
              {shown.length} document{shown.length === 1 ? "" : "s"}
              {filtered ? ` of ${rows.length}` : ""} · {deals.length} deal{deals.length === 1 ? "" : "s"}
            </span>
            {blockingTotal > 0 ? <Chip tone="blocked">{blockingTotal} blocking open</Chip> : null}
          </div>
        </div>
      </div>

      <section className="panel" aria-label="Document vault">
        <form method="get" className={styles.toolbar} aria-label="Filter documents">
          <label htmlFor="f-deal" className="sr-only">
            Deal
          </label>
          <select id="f-deal" name="deal" className={`input ${styles.select}`} defaultValue={dealFilter ?? ""}>
            <option value="">All deals</option>
            {deals.map((d) => (
              <option key={d.id} value={d.id}>
                {d.reference} · {d.title}
              </option>
            ))}
          </select>
          <label htmlFor="f-type" className="sr-only">
            Document type
          </label>
          <select id="f-type" name="type" className={`input ${styles.select}`} defaultValue={typeFilter ?? ""}>
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {typeLabel(t)}
              </option>
            ))}
          </select>
          <button type="submit" className="btn">
            Apply filters
          </button>
          {filtered ? (
            <Link className="btn ghost" href="/documents">
              Clear
            </Link>
          ) : null}
          <span className={styles.note}>Every version keeps its SHA-256. Corrections add a version.</span>
        </form>

        {shown.length === 0 ? (
          <p className={styles.empty}>
            <Files aria-hidden />
            {filtered ? "No documents match." : "No documents yet."}{" "}
            {filtered ? (
              <Link className="ext" href="/documents">
                Clear filters
              </Link>
            ) : (
              <Link className="ext" href="/deals">
                Upload from a deal
              </Link>
            )}
          </p>
        ) : (
          <div className={`table-scroll ${styles.scroll}`}>
            <table className={`table ${styles.table}`}>
              <thead>
                <tr>
                  <th scope="col">Document</th>
                  <th scope="col">Deal</th>
                  <th scope="col">Latest version</th>
                  <th scope="col">SHA-256</th>
                  <th scope="col">Analysis</th>
                  <th scope="col">Findings</th>
                  <th scope="col">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ doc, dealId, reference, blocking, other }) => {
                  const v = doc.versions[0];
                  const [tone, label] = v ? (ANALYSIS[v.analysisState] ?? ["neutral", v.analysisState]) : ["neutral" as const, "No version"];
                  return (
                    <tr key={doc.id} className={blocking > 0 ? styles.held : undefined}>
                      <td>
                        <div className={styles.doc}>
                          <FileText aria-hidden />
                          <div>
                            <div className={styles.name}>{doc.title}</div>
                            {doc.title !== typeLabel(doc.documentType) ? <div className={styles.line}>{typeLabel(doc.documentType)}</div> : null}
                          </div>
                        </div>
                      </td>
                      <td>
                        <Link className={styles.ref} href={`/deals/${dealId}`}>
                          {reference}
                        </Link>
                      </td>
                      <td>
                        {v ? (
                          <>
                            <div className={styles.file}>
                              <span className={styles.ver}>v{v.version}</span>
                              {v.fileName}
                            </div>
                            <div className={styles.line}>
                              {fmtDateTime(v.uploadedAt)} · {v.uploadedBy}
                            </div>
                          </>
                        ) : (
                          <span className="faint">-</span>
                        )}
                      </td>
                      <td>{v ? <Hash value={v.sha256} label={`${doc.title} v${v.version} SHA-256`} /> : <span className="faint">-</span>}</td>
                      <td>
                        <Chip tone={tone}>{label}</Chip>
                        {v?.analysisError ? <div className={styles.error}>{v.analysisError}</div> : null}
                      </td>
                      <td>
                        {blocking > 0 ? <Chip tone="blocked">{blocking} blocking</Chip> : null}
                        {other > 0 ? (
                          <div className={styles.line}>
                            {other} warning{other === 1 ? "" : "s"}
                          </div>
                        ) : null}
                        {blocking === 0 && other === 0 ? <span className="faint tiny">None</span> : null}
                      </td>
                      <td>
                        <Link className="btn sm" href={`/deals/${dealId}/documents`} aria-label={`Open ${doc.title} on ${reference}`}>
                          Open
                        </Link>
                      </td>
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
