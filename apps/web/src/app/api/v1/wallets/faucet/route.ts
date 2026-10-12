import { z } from "zod";
import { parseAmount } from "@plimsoll/domain";
import { parseBody, route } from "@/server/http";
import { requestDemoTokens } from "@/server/services/wallets";

const body = z.object({ address: z.string().regex(/^G[A-Z2-7]{55}$/) });
export const POST = route(async ({ req, session }) => requestDemoTokens(session, (await parseBody(req, body)).address, parseAmount("250000")), { idempotent: true });
