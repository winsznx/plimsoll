import { and, eq, inArray, or } from "drizzle-orm";
import { db, schema } from "../db/client";
import { ApiError } from "../http";
import type { SessionContext } from "../auth/session";
import type { ParticipantRole } from "../db/schema";

export type DealRow = typeof schema.deals.$inferSelect;
export type ParticipantRow = typeof schema.dealParticipants.$inferSelect;

export interface DealAccess {
  deal: DealRow;
  participants: ParticipantRow[];
  /** Roles the signed-in user holds on this deal. */
  roles: ParticipantRole[];
  /** Signing addresses this user controls for those roles. */
  addresses: string[];
}

/**
 * Deal visibility: the buyer/supplier organization's members, plus individually invited
 * participants (inspector, forwarder, resolver) scoped to this one deal. Anything else is a 404
 * so deal existence never leaks across tenants.
 */
export async function dealAccess(session: SessionContext, dealId: string): Promise<DealAccess> {
  const [deal] = await db().select().from(schema.deals).where(eq(schema.deals.id, dealId));
  if (!deal) throw new ApiError("NOT_FOUND", "Deal not found.");
  const participants = await db().select().from(schema.dealParticipants).where(eq(schema.dealParticipants.dealId, dealId));

  const orgId = session.org?.id;
  const roles = new Set<ParticipantRole>();
  for (const p of participants) {
    const viaUser = p.userId === session.user.id;
    const viaOrg = orgId !== undefined && p.orgId === orgId && (p.role === "buyer" || p.role === "supplier");
    if (viaUser || viaOrg) roles.add(p.role);
  }
  if (roles.size === 0) throw new ApiError("NOT_FOUND", "Deal not found.");

  const owned = new Set(session.wallets.map((w) => w.address));
  const addresses = participants.filter((p) => roles.has(p.role) && p.signingAddress && owned.has(p.signingAddress)).map((p) => p.signingAddress!);
  return { deal, participants, roles: [...roles], addresses: [...new Set(addresses)] };
}

export function requireRole(access: DealAccess, ...allowed: ParticipantRole[]): ParticipantRole {
  const role = access.roles.find((r) => allowed.includes(r));
  if (!role) throw new ApiError("ROLE_DENIED", `This action requires the ${allowed.join(" or ")} role on this deal.`);
  return role;
}

export async function visibleDealIds(session: SessionContext): Promise<string[]> {
  const orgId = session.org?.id;
  const conds = [eq(schema.dealParticipants.userId, session.user.id)];
  if (orgId) conds.push(and(eq(schema.dealParticipants.orgId, orgId), inArray(schema.dealParticipants.role, ["buyer", "supplier"]))!);
  const rows = await db().selectDistinct({ id: schema.dealParticipants.dealId }).from(schema.dealParticipants).where(or(...conds));
  return rows.map((r) => r.id);
}

export function participantName(participants: ParticipantRow[], address: string): string {
  return participants.find((p) => p.signingAddress === address)?.displayName ?? `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function addressNames(participants: ParticipantRow[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of participants) if (p.signingAddress) m.set(p.signingAddress, p.displayName);
  return m;
}
