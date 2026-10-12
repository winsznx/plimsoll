import { describe, expect, it } from "vitest";
import { attachedProvider, etaSourceFor, newCarrierEvents, providerOfSourceRef } from "./registry";
import { syntheticProvider, syntheticSchedule } from "./synthetic";
import type { CarrierShipment } from "./types";

const MINUTE = 60_000;
const fundedAt = new Date("2026-10-12T08:00:00.000Z");

function shipment(overrides: Partial<CarrierShipment> = {}): CarrierShipment {
  return {
    id: "3f6c2a10-9d1e-4c55-8a0b-1d2e3f405060",
    originPort: "Ningbo",
    destinationPort: "Felixstowe",
    vessel: "MAERSK EMDEN",
    voyage: "442W",
    bookingRef: "MFP-BK-88231",
    carrierRef: "MAEU240518832",
    fundedAt,
    ...overrides,
  };
}

const at = (minutes: number) => new Date(fundedAt.getTime() + minutes * MINUTE);

describe("synthetic carrier feed", () => {
  it("returns identical events for identical inputs", async () => {
    // #given one shipment polled twice at the same instant
    const now = at(24 * 60);
    // #when
    const first = await syntheticProvider.poll(shipment(), now);
    const second = await syntheticProvider.poll(shipment(), now);
    // #then
    expect(second).toEqual(first);
    expect(first.map((e) => e.eventCode)).toEqual(["GATE_IN", "LOADED", "DEPARTED", "ARRIVED", "DISCHARGED"]);
  });

  it("reports nothing before the escrow was funded and only past events after", async () => {
    // #given polls before funding, mid-departure window, and long after
    // #when
    const before = await syntheticProvider.poll(shipment(), at(-5));
    const early = await syntheticProvider.poll(shipment(), at(45));
    // #then
    expect(before).toEqual([]);
    expect(early.map((e) => e.eventCode)).toEqual(["GATE_IN", "LOADED"]);
    expect(early.every((e) => e.occurredAt.getTime() <= at(45).getTime())).toBe(true);
  });

  it("departs after loading and arrives on the ETA it reported", async () => {
    // #given a full schedule
    const events = await syntheticProvider.poll(shipment(), at(24 * 60));
    const byCode = new Map(events.map((e) => [e.eventCode, e]));
    // #then
    expect(byCode.get("DEPARTED")!.occurredAt.getTime()).toBeGreaterThan(byCode.get("LOADED")!.occurredAt.getTime());
    expect(byCode.get("ARRIVED")!.occurredAt).toEqual(byCode.get("DEPARTED")!.etaAt);
    expect(byCode.get("DISCHARGED")!.occurredAt.getTime()).toBeGreaterThan(byCode.get("ARRIVED")!.occurredAt.getTime());
  });

  it("derives the ETA from booking and vessel data", () => {
    // #given two shipments that differ only in booking data
    const a = syntheticSchedule(shipment()).find((e) => e.eventCode === "ARRIVED")!.at;
    const b = syntheticSchedule(shipment({ bookingRef: "MFP-BK-00001", vessel: "CMA CGM TAGE" })).find((e) => e.eventCode === "ARRIVED")!.at;
    // #then both stay inside the compressed window, and the schedule is a function of its inputs
    for (const eta of [a, b]) {
      expect(eta.getTime()).toBeGreaterThanOrEqual(at(6 * 60).getTime());
      expect(eta.getTime()).toBeLessThanOrEqual(at(6 * 60 + 90).getTime());
    }
    expect(syntheticSchedule(shipment()).find((e) => e.eventCode === "ARRIVED")!.at).toEqual(a);
    expect(b).not.toEqual(a);
  });

  it("labels every event as synthetic and never as carrier data", async () => {
    // #given
    const events = await syntheticProvider.poll(shipment({ vessel: null, voyage: null }), at(24 * 60));
    // #then
    expect(syntheticProvider.sourceType).toBe("sample_fixture");
    expect(syntheticProvider.label).toMatch(/not real tracking/);
    expect(events.every((e) => e.description.startsWith("Synthetic:"))).toBe(true);
    expect(events.every((e) => providerOfSourceRef(e.sourceRef)?.id === "synthetic")).toBe(true);
  });
});

describe("carrier event dedupe", () => {
  it("drops events whose source reference is already in the log", async () => {
    // #given a log that already holds the first two events
    const events = await syntheticProvider.poll(shipment(), at(24 * 60));
    const known = events.slice(0, 2).map((e) => e.sourceRef);
    // #when
    const fresh = newCarrierEvents(events, known);
    // #then
    expect(fresh.map((e) => e.eventCode)).toEqual(["DEPARTED", "ARRIVED", "DISCHARGED"]);
  });

  it("is idempotent across repeated polls and drops repeats within one poll", async () => {
    // #given everything already imported, and a poll that repeats an event
    const events = await syntheticProvider.poll(shipment(), at(24 * 60));
    // #when
    const again = newCarrierEvents(events, events.map((e) => e.sourceRef));
    const repeated = newCarrierEvents([...events, events[0]!], []);
    // #then
    expect(again).toEqual([]);
    expect(repeated).toHaveLength(events.length);
  });

  it("keeps different shipments' events apart", async () => {
    // #given two shipments funded at the same moment
    const a = await syntheticProvider.poll(shipment(), at(24 * 60));
    const b = await syntheticProvider.poll(shipment({ id: "9a8b7c6d-0000-4000-8000-000000000002" }), at(24 * 60));
    // #then
    expect(newCarrierEvents(b, a.map((e) => e.sourceRef))).toHaveLength(b.length);
  });
});

describe("feed attachment", () => {
  it("round-trips through the eta source column and ignores other values", () => {
    expect(attachedProvider(etaSourceFor("synthetic"))?.id).toBe("synthetic");
    expect(attachedProvider(null)).toBeNull();
    expect(attachedProvider("manual")).toBeNull();
    expect(attachedProvider("carrier:unknown")).toBeNull();
  });
});
