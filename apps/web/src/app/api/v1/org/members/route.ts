import { route } from "@/server/http";
import { listMembers } from "@/server/services/org-members";

export const GET = route(async ({ session }) => listMembers(session));
