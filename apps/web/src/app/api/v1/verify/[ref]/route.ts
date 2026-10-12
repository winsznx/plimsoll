import { publicRoute } from "@/server/http";
import { publicProof } from "@/server/services/verify";

export const GET = publicRoute<{ ref: string }>(async ({ params }) => publicProof(params.ref));
