import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { submitAction } from "@/server/services/actions";

const body = z.object({ intentId: z.uuid(), signedXdr: z.string().min(20).nullable() });
export const POST = route<{ id: string }>(
  async ({ req, params, session }) => {
    const { intentId, signedXdr } = await parseBody(req, body);
    return submitAction(session, params.id, intentId, signedXdr);
  },
  { idempotent: true },
);
