import { and, desc, eq, inArray } from "drizzle-orm";
import { conservationHolds } from "@plimsoll/domain";
import { explorer, network } from "../chain";
import { db, schema } from "../db/client";
import { ApiError } from "../http";
import { loadSnapshot } from "./snapshot";

/**
 * Public, redacted proof for a deal. Contains chain identifiers, digests and amounts only:
 * no documents, no extracted fields, no party contact details, no dispute text.
 */
export async function publicProof(publicRef: string) {
  const [deal] = await db().select().from(schema.deals).where(eq(schema.deals.publicRef, publicRef));
  if (!deal || !deal.escrowContractId) throw new ApiError("NOT_FOUND", "No public proof exists for this reference.");
  const snap = deal.chainSnapshot ? loadSnapshot(deal.chainSnapshot) : null;
  const txs = await db()
    .select()
    .from(schema.chainTransactions)
    .where(and(eq(schema.chainTransactions.dealId, deal.id), inArray(schema.chainTransactions.status, ["confirmed", "rejected_in_simulation"])))
    .orderBy(desc(schema.chainTransactions.createdAt));
  const bundles = await db().select({ ordinal: schema.evidenceBundles.milestoneOrdinal, digest: schema.evidenceBundles.digest, status: schema.evidenceBundles.status, manifest: schema.evidenceBundles.manifest }).from(schema.evidenceBundles).where(eq(schema.evidenceBundles.dealId, deal.id));

  return {
    reference: deal.reference,
    isSample: deal.isSample,
    network: network().label,
    passphrase: network().passphrase,
    contractId: deal.escrowContractId,
    contractExplorerUrl: explorer("contract", deal.escrowContractId),
    termsDigest: deal.termsDigest,
    asset: { code: deal.terms.asset.code, issuer: deal.terms.asset.issuer, contractId: deal.terms.asset.contractId },
    parties: { buyer: deal.terms.buyer.legalName, supplier: deal.terms.supplier.legalName },
    total: deal.terms.totalUnits,
    chain: snap
      ? {
          status: snap.agreement.status,
          funded: String(snap.agreement.funded),
          released: String(snap.agreement.released),
          refunded: String(snap.agreement.refunded),
          balance: String(snap.balance),
          ledger: snap.ledger,
          readAt: snap.readAt,
          conservationHolds: conservationHolds(snap),
        }
      : null,
    milestones: deal.terms.milestones.map((m) => {
      const cm = snap?.milestones.find((x) => x.id === m.ordinal);
      const anchored = bundles.find((b) => b.ordinal === m.ordinal && b.digest === cm?.evidenceDigest);
      return {
        ordinal: m.ordinal,
        name: m.name,
        amount: m.amountUnits,
        quorum: m.quorum,
        approvals: cm?.approvals.length ?? 0,
        status: cm?.status ?? null,
        evidenceDigest: cm?.evidenceDigest ?? null,
        /** Hashes only, so anyone holding the files can recompute the digest themselves. */
        evidenceManifest: anchored ? { ...anchored.manifest, findings: anchored.manifest.findings.map((f) => ({ ...f, reason: "[redacted]" })) } : null,
      };
    }),
    transactions: txs.map((t) => ({ kind: t.kind, milestoneOrdinal: t.milestoneOrdinal, status: t.status, txHash: t.txHash, ledger: t.ledger, amount: t.amountUnits === null ? null : String(t.amountUnits), errorCode: t.errorCode, at: t.createdAt.toISOString(), explorerUrl: t.txHash ? explorer("tx", t.txHash) : null })),
  };
}

export type PublicProof = Awaited<ReturnType<typeof publicProof>>;
