import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { linkWallet } from "@/server/services/wallets";

const body = z.object({ address: z.string().regex(/^G[A-Z2-7]{55}$/), message: z.string().min(10), signature: z.string().min(10) });
export const POST = route(async ({ req, session }) => {
  await linkWallet(session, await parseBody(req, body));
  return { ok: true };
});
