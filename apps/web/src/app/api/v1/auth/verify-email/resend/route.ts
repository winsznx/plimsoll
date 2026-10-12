import { route } from "@/server/http";
import { resendVerification } from "@/server/services/email-verification";

export const POST = route(async ({ session }) => resendVerification(session));
