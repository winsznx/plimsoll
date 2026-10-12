import type { DealView } from "@/lib/views";
import type { SessionContext } from "@/server/auth/session";
import { listDeals } from "@/server/services/deals";
import { buildDealView } from "@/server/services/views";

/**
 * Every visible deal's view, built one deal at a time. Each view already runs its own queries in
 * parallel; fanning out across deals as well multiplies concurrent queries per page render.
 */
export async function dealViews(session: SessionContext): Promise<DealView[]> {
  const rows = await listDeals(session);
  const views: DealView[] = [];
  for (const row of rows) views.push(await buildDealView(session, row.id));
  return views;
}
