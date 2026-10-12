import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { submitClassic } from "@/server/services/wallets";

const body = z.object({ signedXdr: z.string().min(20) });
export const POST = route(async ({ req, session }) => submitClassic(session, (await parseBody(req, body)).signedXdr));
