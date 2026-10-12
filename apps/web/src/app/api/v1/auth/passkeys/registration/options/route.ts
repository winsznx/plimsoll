import { z } from "zod";
import { registrationOptions } from "@/server/auth/passkeys";
import { parseBody, publicRoute } from "@/server/http";

const body = z.object({ email: z.email(), displayName: z.string().min(2).max(80), orgLegalName: z.string().min(2).max(160), jurisdiction: z.string().min(2).max(80) });

export const POST = publicRoute(async ({ req }) => registrationOptions(await parseBody(req, body)));
