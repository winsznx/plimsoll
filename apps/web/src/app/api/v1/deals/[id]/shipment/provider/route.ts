import { parseBody, route } from "@/server/http";
import { carrierProviderInput, setCarrierProvider } from "@/server/services/carriers";

export const POST = route<{ id: string }>(async ({ req, params, session }) => setCarrierProvider(session, params.id, await parseBody(req, carrierProviderInput)));
