import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { draftInput, updateDraft } from "@/server/services/deals";
import { sendDealInvite } from "@/server/services/invites";
import { buildDealView } from "@/server/services/views";

type P = { id: string };
export const GET = route<P>(async ({ params, session }) => buildDealView(session, params.id));

const patch = z.object({ version: z.number().int().positive(), draft: draftInput });
export const PATCH = route<P>(async ({ req, params, session }) => {
  const { version, draft } = await parseBody(req, patch);
  const updated = await updateDraft(session, params.id, version, draft);
  // A changed invite address gets a new link; the old one stopped working with the edit.
  const inviteEmail = updated.inviteToken ? await sendDealInvite(updated.inviteToken) : null;
  return { version: updated.version, inviteToken: updated.inviteToken, inviteEmail };
});
