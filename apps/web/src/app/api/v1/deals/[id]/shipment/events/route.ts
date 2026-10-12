import { parseBody, route } from "@/server/http";
import { recordShipmentEvent, shipmentEventInput } from "@/server/services/shipments";

export const POST = route<{ id: string }>(async ({ req, params, session }) => {
  await recordShipmentEvent(session, params.id, await parseBody(req, shipmentEventInput));
  return { ok: true };
});
