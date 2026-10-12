import { createHash } from "node:crypto";
import type { CarrierEvent, CarrierEventCode, CarrierEventProvider, CarrierShipment } from "./types";

const MINUTE = 60_000;

/** A voyage compressed into hours so a demo shows the whole lifecycle in one sitting. */
const BASE_TRANSIT_MINUTES = 6 * 60;
const MAX_ETA_SPREAD_MINUTES = 90;

function vesselLabel(s: CarrierShipment): string {
  if (!s.vessel) return "the booked vessel";
  return s.voyage ? `${s.vessel} ${s.voyage}` : s.vessel;
}

/**
 * The ETA spread comes from the booking and vessel fields so two shipments funded at the same
 * moment still differ, while the same shipment always gets the same schedule.
 */
function etaSpreadMinutes(s: CarrierShipment): number {
  const seed = [s.bookingRef, s.carrierRef, s.vessel, s.voyage, s.id].map((v) => v ?? "").join("|");
  const digest = createHash("sha256").update(seed).digest();
  return digest.readUInt32BE(0) % (MAX_ETA_SPREAD_MINUTES + 1);
}

function syntheticEta(s: CarrierShipment): Date {
  return new Date(s.fundedAt.getTime() + (BASE_TRANSIT_MINUTES + etaSpreadMinutes(s)) * MINUTE);
}

export function syntheticSchedule(s: CarrierShipment): { eventCode: CarrierEventCode; at: Date; description: string }[] {
  const t0 = s.fundedAt.getTime();
  const eta = syntheticEta(s);
  return [
    { eventCode: "GATE_IN", at: new Date(t0 + 10 * MINUTE), description: `Synthetic: container gated in at ${s.originPort} terminal` },
    { eventCode: "LOADED", at: new Date(t0 + 30 * MINUTE), description: `Synthetic: loaded on board ${vesselLabel(s)} at ${s.originPort}` },
    { eventCode: "DEPARTED", at: new Date(t0 + 60 * MINUTE), description: `Synthetic: ${vesselLabel(s)} departed ${s.originPort} for ${s.destinationPort}` },
    { eventCode: "ARRIVED", at: eta, description: `Synthetic: ${vesselLabel(s)} arrived at ${s.destinationPort}` },
    { eventCode: "DISCHARGED", at: new Date(eta.getTime() + 30 * MINUTE), description: `Synthetic: container discharged at ${s.destinationPort}` },
  ];
}

export const syntheticProvider: CarrierEventProvider = {
  id: "synthetic",
  label: "Synthetic demo carrier feed · not real tracking",
  sourceType: "sample_fixture",
  confidence: "None. Generated from the deal's funding time and booking fields on a compressed schedule; nothing was observed.",
  async poll(shipment: CarrierShipment, now: Date): Promise<CarrierEvent[]> {
    const eta = syntheticEta(shipment);
    return syntheticSchedule(shipment)
      .filter((e) => e.at.getTime() <= now.getTime())
      .map((e) => ({
        eventCode: e.eventCode,
        description: e.description,
        occurredAt: e.at,
        sourceRef: `synthetic/${shipment.id.slice(0, 8)}/${e.eventCode}`,
        etaAt: e.eventCode === "ARRIVED" || e.eventCode === "DISCHARGED" ? undefined : eta,
        raw: {
          feed: "synthetic",
          generatedFrom: { fundedAt: shipment.fundedAt.toISOString(), bookingRef: shipment.bookingRef, carrierRef: shipment.carrierRef, vessel: shipment.vessel, voyage: shipment.voyage },
          offsetMinutes: Math.round((e.at.getTime() - shipment.fundedAt.getTime()) / MINUTE),
        },
      }));
  },
};
