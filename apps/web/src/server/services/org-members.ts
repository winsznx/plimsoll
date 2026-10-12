import { and, asc, desc, eq, gt, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { appendAudit } from "../audit";
import { ORG_INVITE_TTL_MS, expiresAt, hashToken, newToken, sameEmail, tokenState } from "../auth/tokens";
import type { SessionContext } from "../auth/session";
import { db, schema, type Tx } from "../db/client";
import { ORG_ROLES, type OrgRole } from "../db/schema";
import { send, type SendResult } from "../email";
import { absoluteUrl, orgInviteEmail } from "../email/messages";
import { ApiError } from "../http";
import { assertEmailVerified } from "./email-verification";
import { INVITABLE_ROLES, canChangeRole, canInvite, canManageMembers, canRemove } from "./org-rules";

export const inviteInput = z.object({ email: z.email().max(254), role: z.enum(INVITABLE_ROLES) });
export const roleInput = z.object({ role: z.enum(ORG_ROLES) });

function requireOrg(session: SessionContext): { orgId: string; orgName: string; role: OrgRole } {
  if (!session.org || !session.role) throw new ApiError("ROLE_DENIED", "Select an organization first.");
  return { orgId: session.org.id, orgName: session.org.legalName, role: session.role };
}

function deny(reason: string | null): void {
  if (reason) throw new ApiError("ROLE_DENIED", reason);
}

/** Locks the org's active memberships so concurrent role changes cannot both pass the last-owner check. */
async function lockedMembers(tx: Tx, orgId: string) {
  return tx
    .select({ id: schema.memberships.id, userId: schema.memberships.userId, role: schema.memberships.role })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.status, "active")))
    .for("update");
}

export interface MemberView {
  userId: string;
  displayName: string;
  email: string;
  role: OrgRole;
  joinedAt: string;
  isYou: boolean;
  removeBlocked: string | null;
  roleBlocked: Record<OrgRole, string | null>;
}

export interface PendingInviteView {
  id: string;
  email: string;
  role: OrgRole;
  invitedBy: string;
  expiresAt: string;
  createdAt: string;
}

export async function listMembers(session: SessionContext): Promise<{ members: MemberView[]; invites: PendingInviteView[]; manageBlocked: string | null; inviteRoles: { role: (typeof INVITABLE_ROLES)[number]; blocked: string | null }[] }> {
  const { orgId, role } = requireOrg(session);
  const rows = await db()
    .select({ m: schema.memberships, user: schema.users })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.status, "active")))
    .orderBy(asc(schema.memberships.createdAt));
  const ownerCount = rows.filter((r) => r.m.role === "owner").length;
  const actor = { userId: session.user.id, role };
  const members = rows.map(({ m, user }) => {
    const target = { userId: m.userId, role: m.role };
    return {
      userId: m.userId,
      displayName: user.displayName,
      email: user.email,
      role: m.role,
      joinedAt: m.createdAt.toISOString(),
      isYou: m.userId === session.user.id,
      removeBlocked: canRemove(actor, target, ownerCount),
      roleBlocked: Object.fromEntries(ORG_ROLES.map((r) => [r, canChangeRole(actor, target, r, ownerCount)])) as Record<OrgRole, string | null>,
    };
  });
  const manageBlocked = canManageMembers(role);
  const invites = manageBlocked
    ? []
    : (
        await db()
          .select({ i: schema.orgInvites, inviter: schema.users.displayName })
          .from(schema.orgInvites)
          .innerJoin(schema.users, eq(schema.users.id, schema.orgInvites.invitedBy))
          .where(and(eq(schema.orgInvites.orgId, orgId), isNull(schema.orgInvites.acceptedAt), isNull(schema.orgInvites.revokedAt), gt(schema.orgInvites.expiresAt, new Date())))
          .orderBy(desc(schema.orgInvites.createdAt))
      ).map(({ i, inviter }) => ({ id: i.id, email: i.email, role: i.role, invitedBy: inviter, expiresAt: i.expiresAt.toISOString(), createdAt: i.createdAt.toISOString() }));
  const inviteRoles = INVITABLE_ROLES.map((r) => ({ role: r, blocked: canInvite(role, r) }));
  return { members, invites, manageBlocked, inviteRoles };
}

export async function inviteMember(session: SessionContext, input: z.infer<typeof inviteInput>): Promise<{ id: string; email: string; role: OrgRole; expiresAt: string; joinUrl: string; delivery: SendResult["status"] }> {
  const { orgId, orgName, role } = requireOrg(session);
  deny(canInvite(role, input.role));
  assertEmailVerified(session);
  const email = input.email.trim().toLowerCase();
  const [existing] = await db()
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.status, "active"), eq(schema.users.email, email)));
  if (existing) throw new ApiError("VALIDATION_FAILED", `${email} is already a member of ${orgName}.`);

  const token = newToken();
  const expires = expiresAt(ORG_INVITE_TTL_MS);
  const invite = await db().transaction(async (tx) => {
    // Re-inviting replaces the earlier link so only the newest email works.
    await tx.update(schema.orgInvites).set({ revokedAt: new Date() }).where(and(eq(schema.orgInvites.orgId, orgId), eq(schema.orgInvites.email, email), isNull(schema.orgInvites.acceptedAt), isNull(schema.orgInvites.revokedAt)));
    const [row] = await tx.insert(schema.orgInvites).values({ orgId, email, role: input.role, tokenHash: hashToken(token), invitedBy: session.user.id, expiresAt: expires }).returning();
    await appendAudit(tx, { orgId, actorUserId: session.user.id, actorLabel: session.user.displayName, resourceType: "org_invite", resourceId: row!.id, action: "org.member_invited", evidence: { email, role: input.role } });
    return row!;
  });
  const delivery = await send(orgInviteEmail(email, { org: orgName, inviter: session.user.displayName, role: input.role, token, expiresAt: expires }));
  return { id: invite.id, email, role: input.role, expiresAt: expires.toISOString(), joinUrl: absoluteUrl(`/join/${token}`), delivery: delivery.status };
}

export async function revokeInvite(session: SessionContext, inviteId: string): Promise<void> {
  const { orgId, role } = requireOrg(session);
  deny(canManageMembers(role));
  await db().transaction(async (tx) => {
    const [row] = await tx
      .update(schema.orgInvites)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.orgInvites.id, inviteId), eq(schema.orgInvites.orgId, orgId), isNull(schema.orgInvites.acceptedAt), isNull(schema.orgInvites.revokedAt)))
      .returning();
    if (!row) throw new ApiError("NOT_FOUND", "No pending invitation with that id.");
    await appendAudit(tx, { orgId, actorUserId: session.user.id, actorLabel: session.user.displayName, resourceType: "org_invite", resourceId: row.id, action: "org.invite_revoked", evidence: { email: row.email } });
  });
}

export async function removeMember(session: SessionContext, userId: string): Promise<void> {
  const { orgId, role } = requireOrg(session);
  await db().transaction(async (tx) => {
    const members = await lockedMembers(tx, orgId);
    const target = members.find((m) => m.userId === userId);
    if (!target) throw new ApiError("NOT_FOUND", "That user is not an active member of this organization.");
    deny(canRemove({ userId: session.user.id, role }, target, members.filter((m) => m.role === "owner").length));
    await tx.update(schema.memberships).set({ status: "removed" }).where(eq(schema.memberships.id, target.id));
    // Sessions pointing at this org fall back to another active membership, or none.
    const [fallback] = await tx.select({ orgId: schema.memberships.orgId }).from(schema.memberships).where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.status, "active"), ne(schema.memberships.orgId, orgId))).limit(1);
    await tx.update(schema.sessions).set({ activeOrgId: fallback?.orgId ?? null }).where(and(eq(schema.sessions.userId, userId), eq(schema.sessions.activeOrgId, orgId)));
    const self = userId === session.user.id;
    await appendAudit(tx, { orgId, actorUserId: session.user.id, actorLabel: session.user.displayName, resourceType: "membership", resourceId: target.id, action: self ? "org.member_left" : "org.member_removed", evidence: { userId, role: target.role } });
  });
}

export async function changeRole(session: SessionContext, userId: string, newRole: OrgRole): Promise<{ role: OrgRole }> {
  const { orgId, role } = requireOrg(session);
  await db().transaction(async (tx) => {
    const members = await lockedMembers(tx, orgId);
    const target = members.find((m) => m.userId === userId);
    if (!target) throw new ApiError("NOT_FOUND", "That user is not an active member of this organization.");
    deny(canChangeRole({ userId: session.user.id, role }, target, newRole, members.filter((m) => m.role === "owner").length));
    await tx.update(schema.memberships).set({ role: newRole }).where(eq(schema.memberships.id, target.id));
    await appendAudit(tx, { orgId, actorUserId: session.user.id, actorLabel: session.user.displayName, resourceType: "membership", resourceId: target.id, action: "org.member_role_changed", evidence: { userId, from: target.role, to: newRole } });
  });
  return { role: newRole };
}

async function findOrgInvite(token: string) {
  const [row] = await db()
    .select({ i: schema.orgInvites, org: schema.organizations, inviter: schema.users.displayName })
    .from(schema.orgInvites)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.orgInvites.orgId))
    .innerJoin(schema.users, eq(schema.users.id, schema.orgInvites.invitedBy))
    .where(eq(schema.orgInvites.tokenHash, hashToken(token)));
  return row ?? null;
}

export type OrgInvitePreview =
  | { state: "usable"; orgName: string; jurisdiction: string; verificationState: string; role: OrgRole; email: string; invitedBy: string; expiresAt: string }
  | { state: "expired" | "closed" | "unknown" };

export async function orgInvitePreview(token: string): Promise<OrgInvitePreview> {
  const row = await findOrgInvite(token);
  if (!row) return { state: "unknown" };
  const state = tokenState({ expiresAt: row.i.expiresAt, closedAt: row.i.acceptedAt ?? row.i.revokedAt });
  if (state !== "usable") return { state };
  return { state, orgName: row.org.legalName, jurisdiction: row.org.jurisdiction, verificationState: row.org.verificationState, role: row.i.role, email: row.i.email, invitedBy: row.inviter, expiresAt: row.i.expiresAt.toISOString() };
}

/**
 * Joins the invited organization and makes it the active one. The token was delivered to the
 * invited address, so accepting it also proves control of that address.
 */
export async function acceptOrgInvite(session: SessionContext, token: string): Promise<{ orgId: string; role: OrgRole }> {
  if (session.method === "api_key") throw new ApiError("ROLE_DENIED", "Invitations are accepted by a signed-in person, not an API key.");
  const row = await findOrgInvite(token);
  const state = row ? tokenState({ expiresAt: row.i.expiresAt, closedAt: row.i.acceptedAt ?? row.i.revokedAt }) : "unknown";
  if (!row || state !== "usable") throw new ApiError("NOT_FOUND", "This invitation is invalid, used, withdrawn or expired.");
  if (!sameEmail(row.i.email, session.user.email)) throw new ApiError("ROLE_DENIED", `This invitation was issued to ${row.i.email}. Sign in with that account to accept it.`);
  const invite = row.i;

  await db().transaction(async (tx) => {
    const [claimed] = await tx
      .update(schema.orgInvites)
      .set({ acceptedAt: new Date(), acceptedBy: session.user.id })
      .where(and(eq(schema.orgInvites.id, invite.id), isNull(schema.orgInvites.acceptedAt), isNull(schema.orgInvites.revokedAt)))
      .returning({ id: schema.orgInvites.id });
    if (!claimed) throw new ApiError("NOT_FOUND", "This invitation was already used or withdrawn.");
    const [membership] = await tx.select().from(schema.memberships).where(and(eq(schema.memberships.orgId, invite.orgId), eq(schema.memberships.userId, session.user.id)));
    if (membership?.status === "active") throw new ApiError("VALIDATION_FAILED", `You are already a member of ${row.org.legalName}.`);
    if (membership) await tx.update(schema.memberships).set({ status: "active", role: invite.role }).where(eq(schema.memberships.id, membership.id));
    else await tx.insert(schema.memberships).values({ orgId: invite.orgId, userId: session.user.id, role: invite.role });
    const verifiedNow = !session.user.emailVerifiedAt;
    if (verifiedNow) await tx.update(schema.users).set({ emailVerifiedAt: new Date() }).where(eq(schema.users.id, session.user.id));
    await tx.update(schema.sessions).set({ activeOrgId: invite.orgId }).where(eq(schema.sessions.id, session.sessionId));
    await appendAudit(tx, { orgId: invite.orgId, actorUserId: session.user.id, actorLabel: session.user.displayName, resourceType: "org_invite", resourceId: invite.id, action: "org.invite_accepted", evidence: { role: invite.role, email: invite.email, emailVerifiedByInvite: verifiedNow } });
  });
  return { orgId: invite.orgId, role: invite.role };
}

export async function userMemberships(userId: string): Promise<{ orgId: string; name: string; role: OrgRole }[]> {
  const rows = await db()
    .select({ orgId: schema.organizations.id, name: schema.organizations.displayName, role: schema.memberships.role })
    .from(schema.memberships)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.orgId))
    .where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.status, "active")))
    .orderBy(asc(schema.organizations.displayName));
  return rows;
}

export async function switchOrg(session: SessionContext, orgId: string): Promise<{ orgId: string; role: OrgRole }> {
  if (session.method === "api_key") throw new ApiError("ROLE_DENIED", "An API key is bound to the organization that issued it.");
  const [m] = await db().select().from(schema.memberships).where(and(eq(schema.memberships.userId, session.user.id), eq(schema.memberships.orgId, orgId), eq(schema.memberships.status, "active")));
  if (!m) throw new ApiError("ROLE_DENIED", "You are not an active member of that organization.");
  if (session.org?.id === orgId) return { orgId, role: m.role };
  await db().transaction(async (tx) => {
    await tx.update(schema.sessions).set({ activeOrgId: orgId }).where(eq(schema.sessions.id, session.sessionId));
    await appendAudit(tx, { orgId, actorUserId: session.user.id, actorLabel: session.user.displayName, resourceType: "session", resourceId: session.sessionId, action: "session.org_switched", evidence: { from: session.org?.id ?? null, to: orgId } });
  });
  return { orgId, role: m.role };
}
