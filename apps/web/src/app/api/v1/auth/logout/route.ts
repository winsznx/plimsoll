import { destroySession } from "@/server/auth/session";
import { publicRoute } from "@/server/http";

export const POST = publicRoute(async () => {
  await destroySession();
  return { ok: true };
});
