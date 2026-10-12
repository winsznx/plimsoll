import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { switchOrg } from "@/server/services/org-members";

export const POST = route(async ({ req, session }) => switchOrg(session, (await parseBody(req, z.object({ orgId: z.uuid() }))).orgId));
