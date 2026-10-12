import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { verifyAuthentication } from "@/server/auth/passkeys";
import { publicRoute } from "@/server/http";

export const POST = publicRoute(async ({ req }) => verifyAuthentication((await req.json()) as AuthenticationResponseJSON));
