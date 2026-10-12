import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { markNotificationsRead, notificationsFor } from "@/server/services/workspace";

export const GET = route(async ({ session }) => (await notificationsFor(session)).map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, href: n.href, readAt: n.readAt?.toISOString() ?? null, createdAt: n.createdAt.toISOString() })));

const body = z.object({ ids: z.union([z.array(z.uuid()), z.literal("all")]) });
export const POST = route(async ({ req, session }) => {
  await markNotificationsRead(session, (await parseBody(req, body)).ids);
  return { ok: true };
});
