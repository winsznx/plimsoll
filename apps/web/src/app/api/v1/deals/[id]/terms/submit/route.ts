import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { submitForAcceptance } from "@/server/services/deals";

const body = z.object({ version: z.number().int().positive() });
export const POST = route<{ id: string }>(async ({ req, params, session }) => submitForAcceptance(session, params.id, (await parseBody(req, body)).version), { idempotent: true });
