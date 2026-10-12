import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { verifyRegistration } from "@/server/auth/passkeys";
import { publicRoute } from "@/server/http";

export const POST = publicRoute(async ({ req }) => verifyRegistration((await req.json()) as RegistrationResponseJSON));
