import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { prepareTrustline } from "@/server/services/wallets";

const body = z.object({ address: z.string().regex(/^G[A-Z2-7]{55}$/) });
export const POST = route(async ({ req, session }) => prepareTrustline(session, (await parseBody(req, body)).address));
