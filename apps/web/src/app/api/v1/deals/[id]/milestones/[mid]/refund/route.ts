import { route } from "@/server/http";
import { executePermissionless } from "@/server/services/actions";

export const POST = route<{ id: string; mid: string }>(async ({ params, session }) => executePermissionless(session, params.id, "refund_expired", Number(params.mid)), { idempotent: true });
