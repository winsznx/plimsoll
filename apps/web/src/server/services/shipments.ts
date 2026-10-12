import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { appendAudit } from "../audit";
import { db, schema } from "../db/client";
import { ApiError } from "../http";
import type { SessionContext } from "../auth/session";
import { dealAccess, requireRole } from "./access";
import { notifyParticipants } from "./notify";

export const STAGE_ORDER = ["booked", "at_origin", "handed_to_carrier", "in_transit", "arrived", "delivered"] as const;

export const shipmentEventInput = z.object({
  eventCode: z.enum(["BOOKED", "GATE_IN", "HANDED_TO_CARRIER", "LOADED", "DEPARTED", "ARRIVED", "DISCHARGED", "DELIVERED"]),
  description: z.string().min(3).max(400),
  occurredAt: z.iso.datetime(),
  sourceType: z.enum(["manual", "carrier_api", "edi"]),
  sourceRef: z.string().max(200).nullable(),
  attest: z.boolean(),
});

export const STAGE_FOR: Record<z.infer<typeof shipmentEventInput>["eventCode"], (typeof STAGE_ORDER)[number]> = {
  BOOKED: "booked",
  GATE_IN: "at_origin",
  HANDED_TO_CARRIER: "handed_to_carrier",
  LOADED: "handed_to_carrier",
  DEPARTED: "in_transit",
  ARRIVED: "arrived",
  DISCHARGED: "arrived",
  DELIVERED: "delivered",
};

/**
 * Transport events are context. Only an appointed forwarder or inspector may mark an event as
 * their attestation, and even then it counts toward release only through an on-chain approval.
 */
export async function recordShipmentEvent(session: SessionContext, dealId: string, input: z.infer<typeof shipmentEventInput>): Promise<void> {
  const access = await dealAccess(session, dealId);
  const role = requireRole(access, "forwarder", "supplier", "inspector", "buyer");
  if (input.attest && role !== "forwarder" && role !== "inspector") throw new ApiError("ROLE_DENIED", "Only an appointed forwarder or inspector can attest a shipment event.");
  const signer = input.attest ? access.participants.find((p) => p.role === role && access.addresses.includes(p.signingAddress ?? ""))?.signingAddress ?? null : null;
  if (input.attest && !signer) throw new ApiError("WALLET_REQUIRED", "Attestations must come from your appointed signing address.");
  const [shipment] = await db().select().from(schema.shipments).where(eq(schema.shipments.dealId, dealId));
  if (!shipment) throw new ApiError("NOT_FOUND", "No shipment on this deal.");

  await db().transaction(async (tx) => {
    const [ev] = await tx
      .insert(schema.shipmentEvents)
      .values({ shipmentId: shipment.id, eventCode: input.eventCode, description: input.description, occurredAt: new Date(input.occurredAt), sourceType: input.sourceType, sourceRef: input.sourceRef, recordedBy: session.user.id, isAttestation: input.attest, signerAddress: signer })
      .returning();
    const next = STAGE_FOR[input.eventCode];
    if (STAGE_ORDER.indexOf(next) > STAGE_ORDER.indexOf(shipment.stage)) await tx.update(schema.shipments).set({ stage: next }).where(eq(schema.shipments.id, shipment.id));
    await appendAudit(tx, { orgId: session.org?.id, dealId, actorUserId: session.user.id, actorLabel: `${session.user.displayName} (${role})`, resourceType: "shipment_event", resourceId: ev!.id, action: input.attest ? "shipment.attested" : "shipment.event_recorded", evidence: { eventCode: input.eventCode, sourceType: input.sourceType } });
  });
  await notifyParticipants(dealId, { kind: "shipment.event", title: `${access.deal.reference}: ${input.eventCode.replaceAll("_", " ").toLowerCase()}`, body: `${input.attest ? "Attested" : "Recorded"} by ${session.user.displayName}, source ${input.sourceType}.`, path: `/deals/${dealId}#shipment` }, session.user.id);
}

export async function shipmentFor(dealId: string) {
  const [shipment] = await db().select().from(schema.shipments).where(eq(schema.shipments.dealId, dealId));
  if (!shipment) return null;
  const events = await db().select().from(schema.shipmentEvents).where(eq(schema.shipmentEvents.shipmentId, shipment.id)).orderBy(desc(schema.shipmentEvents.occurredAt));
  return { ...shipment, events };
}
