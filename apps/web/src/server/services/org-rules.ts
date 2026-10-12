import type { OrgRole } from "../db/schema";

/**
 * Pure membership rules. Each returns null when the action is allowed, otherwise the reason it is
 * not, so the same text can be shown as a why-not in the UI and as the API error.
 */

export interface MemberRef {
  userId: string;
  role: OrgRole;
}

export const INVITABLE_ROLES = ["admin", "member"] as const satisfies readonly OrgRole[];
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export function canManageMembers(actor: OrgRole | null): string | null {
  return actor === "owner" || actor === "admin" ? null : "Only organization owners and admins can manage members.";
}

/** Owners invite admins or members; admins invite members. Ownership is granted by promotion, never by invitation. */
export function canInvite(actor: OrgRole | null, role: InvitableRole): string | null {
  const manage = canManageMembers(actor);
  if (manage) return manage;
  if (actor === "admin" && role !== "member") return "Admins can invite members only. Ask an owner to invite an admin.";
  return null;
}

/** Anyone may leave; owners remove anyone; admins remove members. Nobody removes the last owner. */
export function canRemove(actor: MemberRef, target: MemberRef, ownerCount: number): string | null {
  if (actor.userId !== target.userId) {
    if (actor.role === "member") return "Only organization owners and admins can remove members.";
    if (actor.role === "admin" && target.role !== "member") return "Admins can remove members only.";
  }
  if (target.role === "owner" && ownerCount <= 1) return "The last owner cannot be removed. Promote another member to owner first.";
  return null;
}

export function canChangeRole(actor: MemberRef, target: MemberRef, role: OrgRole, ownerCount: number): string | null {
  if (actor.role !== "owner") return "Only owners can change roles.";
  if (target.role === role) return `Already ${role}.`;
  if (target.role === "owner" && ownerCount <= 1) return "The last owner cannot be demoted. Promote another member to owner first.";
  return null;
}
