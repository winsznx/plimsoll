import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { acceptInvite } from "@/server/services/invites";

const body = z.object({ signingAddress: z.string().regex(/^G[A-Z2-7]{55}$/) });
export const POST = route<{ token: string }>(async ({ req, params, session }) => acceptInvite(session, params.token, (await parseBody(req, body)).signingAddress));
