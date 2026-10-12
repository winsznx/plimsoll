import { createHash } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { appendAudit } from "../audit";
import { network } from "../chain";
import { db, schema } from "../db/client";
import { send, type SendResult } from "../email";
import { dealInviteEmail } from "../email/messages";
import { ApiError } from "../http";
import type { SessionContext } from "../auth/session";
import { linkWalletOwners } from "./deals";
import { notifyParticipants } from "./notify";

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function findInvite(token: string) {
  const [row] = await db()
    .select({ p: schema.dealParticipants, d: schema.deals })
    .from(schema.dealParticipants)
    .innerJoin(schema.deals, eq(schema.deals.id, schema.dealParticipants.dealId))
    .where(and(eq(schema.dealParticipants.inviteTokenHash, tokenHash(token)), eq(schema.dealParticipants.status, "invited"), gt(schema.dealParticipants.inviteExpiresAt, new Date())));
  return row ?? null;
}

/** Emails a freshly issued deal invitation to the address it was issued for. */
export async function sendDealInvite(token: string): Promise<SendResult["status"] | null> {
  const row = await findInvite(token);
  if (!row?.p.inviteEmail || !row.p.inviteExpiresAt) return null;
  const result = await send(dealInviteEmail(row.p.inviteEmail, { buyer: row.d.terms.buyer.legalName, reference: row.d.reference, role: row.p.role, token, expiresAt: row.p.inviteExpiresAt }));
  return result.status;
}

/** Minimal, non-sensitive preview so the invitee can see what they are joining before signing in. */
export async function invitePreview(token: string) {
  const row = await findInvite(token);
  if (!row) throw new ApiError("NOT_FOUND", "This invitation is invalid, used or expired.");
  return { reference: row.d.reference, title: row.d.title, role: row.p.role, invitedAs: row.p.displayName, buyer: row.d.terms.buyer.legalName, inviteEmail: row.p.inviteEmail, expiresAt: row.p.inviteExpiresAt!.toISOString(), network: network().label };
}

/**
 * Binds the invited supplier seat to the signed-in user and their wallet. Allowed only while the
 * deal is a draft, because the supplier address is part of the terms digest.
 */
export async function acceptInvite(session: SessionContext, token: string, signingAddress: string): Promise<{ dealId: string }> {
  const row = await findInvite(token);
  if (!row) throw new ApiError("NOT_FOUND", "This invitation is invalid, used or expired.");
  if (row.d.status !== "draft") throw new ApiError("TERMS_VERSION_STALE", "Terms were already frozen; ask the buyer to reissue.");
  if (row.p.inviteEmail && row.p.inviteEmail.toLowerCase() !== session.user.email.toLowerCase()) {
    throw new ApiError("ROLE_DENIED", `This invitation was issued to ${row.p.inviteEmail}. Sign in with that account to accept it.`);
  }
  if (!session.wallets.some((w) => w.address === signingAddress && w.network === network().id)) throw new ApiError("WALLET_REQUIRED", "Link the wallet you will sign with before accepting the invitation.");
  if (signingAddress === row.d.terms.buyer.address) throw new ApiError("VALIDATION_FAILED", "The supplier must sign with a different address than the buyer.");

  const terms = structuredClone(row.d.terms);
  if (row.p.role === "supplier") {
    terms.supplier.address = signingAddress;
    if (session.org) terms.supplier.orgId = session.org.id;
    for (const m of terms.milestones) {
      if (!m.payee) m.payee = signingAddress;
      for (const a of m.approvers) if (a.role === "supplier" && !a.address) a.address = signingAddress;
    }
  }
  await db().transaction(async (tx) => {
    await tx.update(schema.dealParticipants).set({ userId: session.user.id, orgId: session.org?.id ?? row.p.orgId, signingAddress, status: "active", inviteTokenHash: null }).where(eq(schema.dealParticipants.id, row.p.id));
    await tx.update(schema.deals).set({ terms, version: row.d.version + 1, supplierOrgId: row.p.role === "supplier" ? (session.org?.id ?? row.d.supplierOrgId) : row.d.supplierOrgId, updatedAt: new Date() }).where(eq(schema.deals.id, row.d.id));
    await linkWalletOwners(tx, row.d.id);
    await appendAudit(tx, { orgId: session.org?.id, dealId: row.d.id, actorUserId: session.user.id, actorLabel: session.user.displayName, resourceType: "deal_participant", resourceId: row.p.id, action: "deal.invite_accepted", evidence: { role: row.p.role, signingAddress } });
  });
  await notifyParticipants(row.d.id, { kind: "invite.accepted", title: `${row.d.reference}: ${row.p.displayName} joined`, body: "The supplier registered a signing address. Terms can now be frozen.", path: `/deals/${row.d.id}` }, session.user.id);
  return { dealId: row.d.id };
}
