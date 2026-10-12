import { syntheticProvider } from "./synthetic";
import type { CarrierEvent, CarrierEventProvider } from "./types";

export const CARRIER_PROVIDERS: Readonly<Record<string, CarrierEventProvider>> = {
  [syntheticProvider.id]: syntheticProvider,
};

export const CARRIER_PROVIDER_IDS = Object.keys(CARRIER_PROVIDERS) as [string, ...string[]];

export function carrierProvider(id: string): CarrierEventProvider | null {
  return CARRIER_PROVIDERS[id] ?? null;
}

/**
 * The attached feed lives in `shipments.eta_source` as `carrier:<id>`: when a feed is attached it
 * is, by definition, where the ETA comes from.
 */
const ETA_SOURCE_PREFIX = "carrier:";

export function etaSourceFor(providerId: string): string {
  return `${ETA_SOURCE_PREFIX}${providerId}`;
}

export function attachedProvider(etaSource: string | null): CarrierEventProvider | null {
  if (!etaSource?.startsWith(ETA_SOURCE_PREFIX)) return null;
  return carrierProvider(etaSource.slice(ETA_SOURCE_PREFIX.length));
}

export function providerOfSourceRef(sourceRef: string | null): CarrierEventProvider | null {
  const id = sourceRef?.split("/", 1)[0];
  return id ? carrierProvider(id) : null;
}

/** Events the shipment log does not hold yet, deduped by source reference within the poll too. */
export function newCarrierEvents(polled: CarrierEvent[], knownSourceRefs: Iterable<string>): CarrierEvent[] {
  const seen = new Set(knownSourceRefs);
  const fresh: CarrierEvent[] = [];
  for (const e of polled) {
    if (seen.has(e.sourceRef)) continue;
    seen.add(e.sourceRef);
    fresh.push(e);
  }
  return fresh;
}

/** Scheduler slot that records when a shipment's feed was last read. */
export function pollSlotName(shipmentId: string): string {
  return `carrier_poll:${shipmentId}`;
}
