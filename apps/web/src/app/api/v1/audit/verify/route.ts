import { verifyAuditChain } from "@/server/audit";
import { route } from "@/server/http";

export const GET = route(async () => verifyAuditChain());
