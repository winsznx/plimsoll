import { route } from "@/server/http";
import { acceptOrgInvite } from "@/server/services/org-members";

export const POST = route<{ token: string }>(async ({ params, session }) => acceptOrgInvite(session, params.token));
