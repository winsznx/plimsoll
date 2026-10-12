import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { changeRole, removeMember, roleInput } from "@/server/services/org-members";

const userId = z.uuid();

export const PATCH = route<{ userId: string }>(async ({ req, params, session }) => changeRole(session, userId.parse(params.userId), (await parseBody(req, roleInput)).role));

export const DELETE = route<{ userId: string }>(async ({ params, session }) => {
  await removeMember(session, userId.parse(params.userId));
  return { ok: true };
});
