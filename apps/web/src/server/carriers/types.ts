export type CarrierEventCode = "GATE_IN" | "LOADED" | "DEPARTED" | "ARRIVED" | "DISCHARGED" | "DELIVERED";

export type CarrierSourceType = "carrier_api" | "edi" | "sample_fixture";

export interface CarrierEvent {
  eventCode: CarrierEventCode;
  description: string;
  occurredAt: Date;
  /**
   * Stable reference for this event, prefixed `<provider id>/` so the log can name its source.
   * It is the dedupe key within one shipment.
   */
  sourceRef: string;
  /** The ETA the source reported alongside this event, if any. */
  etaAt?: Date;
  raw: Record<string, unknown>;
}

/** What an adapter may read about a shipment. Nothing here is secret or document content. */
export interface CarrierShipment {
  id: string;
  originPort: string;
  destinationPort: string;
  vessel: string | null;
  voyage: string | null;
  bookingRef: string | null;
  carrierRef: string | null;
  /** Ledger-confirmed funding time; adapters anchor nothing before the escrow is live. */
  fundedAt: Date;
}

/**
 * One external transport source. Real carrier or EDI adapters implement this; a provider never
 * claims coverage it does not have, and its events are context, never release conditions.
 */
export interface CarrierEventProvider {
  id: string;
  label: string;
  sourceType: CarrierSourceType;
  /** Plain statement of how far these events can be trusted, shown next to them. */
  confidence: string;
  poll(shipment: CarrierShipment, now: Date): Promise<CarrierEvent[]>;
}
