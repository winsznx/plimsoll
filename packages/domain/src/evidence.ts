import { DIGEST_DOMAINS, domainDigest, type Canonical } from "./digest";

export const EVIDENCE_SCHEMA = "plimsoll.evidence.v1";

export interface EvidenceDocumentRef {
  documentId: string;
  versionId: string;
  version: number;
  documentType: string;
  sha256: string;
}

export interface EvidenceFindingRef {
  ruleId: string;
  fingerprint: string;
  state: "resolved" | "accepted_as_is" | "non_material";
  reason: string;
}

export interface EvidenceAttestationRef {
  signer: string;
  statement: string;
  digest: string;
}

export interface EvidenceManifest {
  schema: typeof EVIDENCE_SCHEMA;
  dealId: string;
  milestoneOrdinal: number;
  agreementDigest: string;
  documents: EvidenceDocumentRef[];
  findings: EvidenceFindingRef[];
  attestations: EvidenceAttestationRef[];
}

/** Sorts every collection so two parties assembling the same evidence get the same bytes. */
export function normalizeManifest(m: EvidenceManifest): EvidenceManifest {
  return {
    ...m,
    documents: [...m.documents].sort((a, b) => a.sha256.localeCompare(b.sha256) || a.versionId.localeCompare(b.versionId)),
    findings: [...m.findings].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint)),
    attestations: [...m.attestations].sort((a, b) => a.digest.localeCompare(b.digest)),
  };
}

export async function evidenceDigest(manifest: EvidenceManifest): Promise<string> {
  return domainDigest(DIGEST_DOMAINS.evidence, normalizeManifest(manifest) as unknown as Canonical);
}
