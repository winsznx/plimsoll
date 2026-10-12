import { authenticationOptions } from "@/server/auth/passkeys";
import { publicRoute } from "@/server/http";

export const POST = publicRoute(async () => authenticationOptions());
