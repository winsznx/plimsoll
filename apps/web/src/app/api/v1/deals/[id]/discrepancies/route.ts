import { route } from "@/server/http";
import { buildDiscrepancyViews, requireDealAccess } from "@/server/services/views";

export const GET = route<{ id: string }>(async ({ params, session }) => {
  await requireDealAccess(session, params.id);
  return buildDiscrepancyViews(params.id);
});
