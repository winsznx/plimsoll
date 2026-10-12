import { route } from "@/server/http";
import { requireDealAccess } from "@/server/services/views";
import { activityFeed } from "@/server/services/workspace";

export const GET = route<{ id: string }>(async ({ params, session }) => {
  await requireDealAccess(session, params.id);
  return activityFeed(session, { dealId: params.id, limit: 500 });
});
