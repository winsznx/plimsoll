import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { inviteInput, inviteMember, listMembers, revokeInvite } from "@/server/services/org-members";

export const GET = route(async ({ session }) => (await listMembers(session)).invites);
export const POST = route(async ({ req, session }) => inviteMember(session, await parseBody(req, inviteInput)), { idempotent: true });
export const DELETE = route(async ({ req, session }) => {
  await revokeInvite(session, (await parseBody(req, z.object({ id: z.uuid() }))).id);
  return { ok: true };
});
