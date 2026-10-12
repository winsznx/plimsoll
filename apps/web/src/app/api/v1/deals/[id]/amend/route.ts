import { route } from "@/server/http";
import { reopenForAmendment } from "@/server/services/deals";

export const POST = route<{ id: string }>(async ({ params, session }) => {
  await reopenForAmendment(session, params.id);
  return { ok: true };
});
