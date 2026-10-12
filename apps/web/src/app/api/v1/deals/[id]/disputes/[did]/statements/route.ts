import { parseBody, route } from "@/server/http";
import { addStatement, statementInput } from "@/server/services/disputes";

export const POST = route<{ id: string; did: string }>(async ({ req, params, session }) => {
  await addStatement(session, params.id, params.did, (await parseBody(req, statementInput)).body);
  return { ok: true };
});
