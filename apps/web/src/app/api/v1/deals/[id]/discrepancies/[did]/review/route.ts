import { parseBody, route } from "@/server/http";
import { reviewDiscrepancy, reviewInput } from "@/server/services/reconcile";

export const POST = route<{ id: string; did: string }>(async ({ req, params, session }) => {
  await reviewDiscrepancy(session, params.id, params.did, await parseBody(req, reviewInput));
  return { ok: true };
});
