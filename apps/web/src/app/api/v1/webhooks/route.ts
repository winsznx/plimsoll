import { parseBody, route } from "@/server/http";
import { createWebhook, listWebhooks, webhookInput } from "@/server/services/integrations";

export const GET = route(async ({ session }) => listWebhooks(session));
export const POST = route(async ({ req, session }) => createWebhook(session, await parseBody(req, webhookInput)));
