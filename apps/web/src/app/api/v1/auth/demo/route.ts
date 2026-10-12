import { z } from "zod";
import { DEMO_PERSONA_KEYS } from "@/server/chain";
import { createSession } from "@/server/auth/session";
import { ApiError, parseBody, publicRoute } from "@/server/http";
import { DEMO_PERSONAS, ensureDemoPersonas, personaSession } from "@/server/seed";

const body = z.object({ persona: z.enum(DEMO_PERSONA_KEYS) });

export const POST = publicRoute(async ({ req }) => {
  const { persona } = await parseBody(req, body);
  if (!(await ensureDemoPersonas())) throw new ApiError("RECONCILIATION_REQUIRED", "Demo personas need testnet bootstrap. Run `pnpm bootstrap:testnet`.");
  const s = await personaSession(persona);
  await createSession(s.user.id, s.org?.id ?? null, "demo");
  return { user: s.user.displayName, org: s.org?.legalName ?? null, title: DEMO_PERSONAS[persona].title };
});
