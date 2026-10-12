import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { createApiKey, listApiKeys, revokeApiKey } from "@/server/services/integrations";

export const GET = route(async ({ session }) => listApiKeys(session));
export const POST = route(async ({ req, session }) => createApiKey(session, (await parseBody(req, z.object({ name: z.string().min(2).max(60) }))).name));
export const DELETE = route(async ({ req, session }) => {
  await revokeApiKey(session, (await parseBody(req, z.object({ id: z.uuid() }))).id);
  return { ok: true };
});
