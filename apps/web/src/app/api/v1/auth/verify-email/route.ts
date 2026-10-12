import { z } from "zod";
import { parseBody, publicRoute } from "@/server/http";
import { confirmEmail } from "@/server/services/email-verification";

export const POST = publicRoute(async ({ req }) => confirmEmail((await parseBody(req, z.object({ token: z.string().min(16).max(128) }))).token));
