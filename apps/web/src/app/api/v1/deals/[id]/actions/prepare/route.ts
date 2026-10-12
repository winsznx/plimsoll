import { parseBody, route } from "@/server/http";
import { actionInput, prepareAction } from "@/server/services/actions";

export const POST = route<{ id: string }>(async ({ req, params, session }) => prepareAction(session, params.id, await parseBody(req, actionInput)));
