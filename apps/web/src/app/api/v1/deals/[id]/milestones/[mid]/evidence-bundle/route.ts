import { route } from "@/server/http";
import { prepareBundle } from "@/server/services/evidence";

export const POST = route<{ id: string; mid: string }>(async ({ params, session }) => prepareBundle(session, params.id, Number(params.mid)));
