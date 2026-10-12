import { route } from "@/server/http";
import { requireDealAccess } from "@/server/services/views";
import { syncDeal } from "@/server/services/sync";

export const POST = route<{ id: string }>(async ({ params, session }) => {
  await requireDealAccess(session, params.id);
  return syncDeal(params.id);
});
