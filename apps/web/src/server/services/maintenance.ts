import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { isChainRejected, isRpcUnavailable } from "@plimsoll/stellar";
import { appendAudit } from "../audit";
import { gateway, network } from "../chain";
import { db, schema } from "../db/client";

const IDLE_MS = 6 * 24 * 60 * 60 * 1000;

/**
 * Every escrow call already extends TTL, so only idle escrows need help. A live escrow untouched
 * for six days gets a permissionless `extend_ttl` from the relayer, well inside the 7-day
 * threshold the contract uses, so agreement, milestone and approval entries never archive.
 */
export async function extendIdleEscrows(): Promise<{ extended: number; failed: number }> {
  const live = await db()
    .select({ id: schema.deals.id, contractId: schema.deals.escrowContractId })
    .from(schema.deals)
    .where(and(isNotNull(schema.deals.escrowContractId), inArray(schema.deals.status, ["awaiting_acceptance", "awaiting_funding", "funded"])));
  let extended = 0;
  let failed = 0;
  for (const deal of live) {
    const [last] = await db().select({ at: schema.chainTransactions.createdAt }).from(schema.chainTransactions).where(eq(schema.chainTransactions.dealId, deal.id)).orderBy(desc(schema.chainTransactions.createdAt)).limit(1);
    if (last && Date.now() - last.at.getTime() < IDLE_MS) continue;
    try {
      const res = await gateway().invokeAsRelayer({ contractId: deal.contractId!, method: "extend_ttl", args: [] });
      await db().transaction(async (tx) => {
        await tx.insert(schema.chainTransactions).values({ dealId: deal.id, kind: "ttl", actorAddress: gateway().relayerAddress, network: network().id, txHash: res.hash, status: res.status === "SUCCESS" ? "confirmed" : "pending", ledger: res.ledger, confirmedAt: res.status === "SUCCESS" ? new Date() : null });
        await appendAudit(tx, { dealId: deal.id, actorLabel: "TTL maintenance", resourceType: "escrow", resourceId: deal.contractId!, action: "escrow.ttl_extended", source: "chain", evidence: { txHash: res.hash, ledger: res.ledger ?? 0 } });
      });
      extended++;
    } catch (e) {
      if (!isChainRejected(e) && !isRpcUnavailable(e)) throw e;
      console.error(`[ttl] ${deal.contractId}: ${e.message}`);
      failed++;
    }
  }
  return { extended, failed };
}
