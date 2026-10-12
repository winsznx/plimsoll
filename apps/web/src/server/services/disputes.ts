import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { appendAudit } from "../audit";
import { db, schema } from "../db/client";
import { ApiError } from "../http";
import type { SessionContext } from "../auth/session";
import { dealAccess, requireRole } from "./access";
import { notifyParticipants } from "./notify";

export const statementInput = z.object({ body: z.string().min(5).max(8000) });

/** Position statements stay off-chain; only the dispute reason digest is public. */
export async function addStatement(session: SessionContext, dealId: string, disputeId: string, body: string): Promise<void> {
  const access = await dealAccess(session, dealId);
  const role = requireRole(access, "buyer", "supplier", "resolver", "inspector", "forwarder");
  const [d] = await db().select().from(schema.disputes).where(and(eq(schema.disputes.id, disputeId), eq(schema.disputes.dealId, dealId)));
  if (!d) throw new ApiError("NOT_FOUND", "Dispute not found.");
  if (d.status === "resolved") throw new ApiError("ALREADY_SETTLED", "This dispute is resolved.");
  await db().transaction(async (tx) => {
    const [s] = await tx.insert(schema.disputeStatements).values({ disputeId, authorUserId: session.user.id, authorRole: role, body }).returning();
    await appendAudit(tx, { orgId: session.org?.id, dealId, actorUserId: session.user.id, actorLabel: `${session.user.displayName} (${role})`, resourceType: "dispute_statement", resourceId: s!.id, action: "dispute.statement_added", evidence: { disputeId } });
  });
  await notifyParticipants(dealId, { kind: "dispute.statement", title: `${access.deal.reference}: new statement in dispute`, body: `${session.user.displayName} (${role}) added a statement.`, path: `/deals/${dealId}/disputes/${d.milestoneOrdinal}` }, session.user.id);
}
