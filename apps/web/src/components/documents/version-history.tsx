import type { DocumentView } from "@/lib/views";
import { fmtDateTime } from "@/lib/format";
import { Hash } from "../hash";
import { AnalysisChip, documentTypeLabel } from "./status";

/** Every stored version, newest first. Superseded versions stay listed and downloadable. */
export function VersionHistory({ dealId, docs }: { dealId: string; docs: DocumentView[] }) {
  if (docs.length === 0) return <p className="empty">No versions stored yet.</p>;
  return (
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            <th>Document</th>
            <th className="num">Version</th>
            <th>SHA-256</th>
            <th>Uploaded</th>
            <th>Analysis</th>
            <th>Original</th>
          </tr>
        </thead>
        <tbody>
          {docs.flatMap((d) =>
            d.versions.map((v, i) => (
              <tr key={v.id}>
                <td>
                  <span className="small">{documentTypeLabel(d.documentType)}</span>
                  <div className="tiny faint">{i === 0 ? "Current" : "Superseded"}</div>
                </td>
                <td className="num">v{v.version}</td>
                <td>
                  <Hash value={v.sha256} label={`SHA-256 of ${d.title} v${v.version}`} />
                </td>
                <td className="small">
                  {v.uploadedBy}
                  <div className="tiny faint mono">{fmtDateTime(v.uploadedAt)}</div>
                </td>
                <td>
                  <AnalysisChip state={v.analysisState} />
                  {v.analysisError ? <div className="tiny" style={{ color: "var(--held-ink)", marginTop: 4 }}>{v.analysisError}</div> : null}
                  {v.detectedType && v.detectedType !== d.documentType ? <div className="tiny muted">Reads as {documentTypeLabel(v.detectedType).toLowerCase()}</div> : null}
                </td>
                <td>
                  <a className="ext" href={`/api/v1/deals/${dealId}/documents/versions/${v.id}/file`} target="_blank" rel="noreferrer">
                    {v.fileName}
                  </a>
                  <div className="tiny faint mono">
                    {(v.bytes / 1024).toFixed(1)} KB{v.pages ? ` · ${v.pages} p.` : ""}
                  </div>
                </td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  );
}
