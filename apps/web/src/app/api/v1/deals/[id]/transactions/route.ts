import { route } from "@/server/http";
import { buildDealView } from "@/server/services/views";

export const GET = route<{ id: string }>(async ({ params, session }) => {
  const view = await buildDealView(session, params.id);
  return { chain: view.chain, transactions: view.transactions };
});
