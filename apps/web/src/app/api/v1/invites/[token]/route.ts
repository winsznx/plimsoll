import { publicRoute } from "@/server/http";
import { invitePreview } from "@/server/services/invites";

export const GET = publicRoute<{ token: string }>(async ({ params }) => invitePreview(params.token));
