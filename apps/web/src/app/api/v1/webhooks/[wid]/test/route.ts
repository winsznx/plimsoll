import { route } from "@/server/http";
import { sendTestDelivery } from "@/server/services/integrations";

export const POST = route<{ wid: string }>(async ({ params, session }) => {
  await sendTestDelivery(session, params.wid);
  return { ok: true };
});
