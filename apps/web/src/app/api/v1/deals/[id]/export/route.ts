import { route } from "@/server/http";
import { bundlesFor } from "@/server/services/evidence";
import { buildDealView } from "@/server/services/views";
import { activityFeed } from "@/server/services/workspace";

/** Downloadable reconciliation record: terms, chain readback, transactions, evidence digests, audit trail. */
export const GET = route<{ id: string }>(async ({ params, session }) => {
  const view = await buildDealView(session, params.id);
  const bundles = await bundlesFor(params.id);
  const audit = await activityFeed(session, { dealId: params.id, limit: 1000 });
  const record = {
    kind: "plimsoll.reconciliation-record.v1",
    generatedAt: new Date().toISOString(),
    disclaimer: view.isSample ? "SAMPLE FIXTURE DEAL on testnet with a demo token (not USDC)." : view.asset.isDemo ? "Testnet deal using a demo token (not USDC)." : null,
    reference: view.reference,
    network: view.network,
    asset: view.asset,
    termsDigest: view.termsDigest,
    terms: view.terms,
    chain: view.chain,
    milestones: view.milestones.map((m) => ({ ordinal: m.ordinal, name: m.name, amountUnits: m.amount, chainStatus: m.chainStatus, evidenceDigest: m.evidenceDigest, approvals: m.approvers.filter((a) => a.approved).map((a) => a.address), settlementTx: m.settlementTx })),
    evidenceBundles: bundles.map((b) => ({ milestone: b.milestoneOrdinal, digest: b.digest, status: b.status, manifest: b.manifest, anchoredTxHash: b.anchoredTxHash })),
    transactions: view.transactions,
    audit,
  };
  return new Response(JSON.stringify(record, null, 2), { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${view.reference}-reconciliation.json"` } });
});
