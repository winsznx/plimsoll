import { and, asc, eq, isNotNull, like } from "drizzle-orm";
import { z } from "zod";
import { appendAudit } from "../audit";
import { attachedProvider, carrierProvider, CARRIER_PROVIDER_IDS, CARRIER_PROVIDERS, etaSourceFor, newCarrierEvents, pollSlotName } from "../carriers/registry";
import type { CarrierEvent, CarrierEventProvider } from "../carriers/types";
import { db, schema } from "../db/client";
import { ApiError } from "../http";
import type { SessionContext } from "../auth/session";
import { dealAccess, requireRole } from "./access";
import { notifyParticipants } from "./notify";
import { STAGE_FOR, STAGE_ORDER } from "./shipments";

type ShipmentRow = typeof schema.shipments.$inferSelect;

export const carrierProviderInput = z.object({
  provider: z.enum(CARRIER_PROVIDER_IDS).nullable(),
});

/** Ledger-confirmed funding time. Feeds anchor to it so nothing is reported before money is committed. */
async function fundedAt(dealId: string): Promise<Date | null> {
  const [row] = await db()
    .select({ confirmedAt: schema.chainTransactions.confirmedAt, createdAt: schema.chainTransactions.createdAt })
    .from(schema.chainTransactions)
    .where(and(eq(schema.chainTransactions.dealId, dealId), eq(schema.chainTransactions.kind, "fund"), eq(schema.chainTransactions.status, "confirmed")))
    .orderBy(asc(schema.chainTransactions.createdAt))
    .limit(1);
  return row ? (row.confirmedAt ?? row.createdAt) : null;
}

function laterStage(current: ShipmentRow["stage"], e: CarrierEvent): ShipmentRow["stage"] {
  const next = STAGE_FOR[e.eventCode];
  return STAGE_ORDER.indexOf(next) > STAGE_ORDER.indexOf(current) ? next : current;
}

/** The ETA the source reported most recently, judged by when the reporting event happened. */
function latestEta(events: CarrierEvent[]): Date | null {
  let best: CarrierEvent | null = null;
  for (const e of events) if (e.etaAt && (!best || e.occurredAt > best.occurredAt)) best = e;
  return best?.etaAt ?? null;
}

async function pollShipment(shipment: ShipmentRow, deal: { id: string; reference: string }, provider: CarrierEventProvider, now: Date): Promise<number> {
  const funded = await fundedAt(deal.id);
  if (!funded) return 0;
  return importCarrierEvents(shipment, deal, provider, funded, now);
}

/** Reads one feed anchored at `funded` and appends what the log lacks. Returns the number imported. */
export async function importCarrierEvents(shipment: ShipmentRow, deal: { id: string; reference: string }, provider: CarrierEventProvider, funded: Date, now: Date): Promise<number> {
  const polled = await provider.poll(
    { id: shipment.id, originPort: shipment.originPort, destinationPort: shipment.destinationPort, vessel: shipment.vessel, voyage: shipment.voyage, bookingRef: shipment.bookingRef, carrierRef: shipment.carrierRef, fundedAt: funded },
    now,
  );

  const fresh = await db().transaction(async (tx) => {
    // The row lock serializes overlapping polls of one shipment so dedupe cannot race.
    const [current] = await tx.select().from(schema.shipments).where(eq(schema.shipments.id, shipment.id)).for("update");
    if (!current || attachedProvider(current.etaSource)?.id !== provider.id) return [];
    const known = await tx
      .select({ sourceRef: schema.shipmentEvents.sourceRef })
      .from(schema.shipmentEvents)
      .where(and(eq(schema.shipmentEvents.shipmentId, shipment.id), eq(schema.shipmentEvents.sourceType, provider.sourceType), isNotNull(schema.shipmentEvents.sourceRef)));
    const toInsert = newCarrierEvents(polled, known.map((k) => k.sourceRef!)).sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

    let stage = current.stage;
    for (const e of toInsert) {
      const [row] = await tx
        .insert(schema.shipmentEvents)
        .values({ shipmentId: shipment.id, eventCode: e.eventCode, description: e.description, occurredAt: e.occurredAt, sourceType: provider.sourceType, sourceRef: e.sourceRef, recordedBy: null, isAttestation: false, signerAddress: null })
        .returning();
      stage = laterStage(stage, e);
      await appendAudit(tx, { dealId: deal.id, actorLabel: provider.label, resourceType: "shipment_event", resourceId: row!.id, action: "shipment.carrier_event_imported", source: "system", evidence: { provider: provider.id, sourceType: provider.sourceType, eventCode: e.eventCode, sourceRef: e.sourceRef, raw: e.raw } });
    }

    const eta = latestEta(polled);
    const etaChanged = eta !== null && eta.getTime() !== current.etaAt?.getTime();
    if (stage !== current.stage || etaChanged) {
      await tx.update(schema.shipments).set({ stage, ...(etaChanged ? { etaAt: eta } : {}) }).where(eq(schema.shipments.id, shipment.id));
    }
    await tx.insert(schema.schedulerState).values({ name: pollSlotName(shipment.id), lastRunAt: now }).onConflictDoUpdate({ target: schema.schedulerState.name, set: { lastRunAt: now } });
    return toInsert;
  });

  if (fresh.length > 0) {
    const codes = fresh.map((e) => e.eventCode.replaceAll("_", " ").toLowerCase()).join(", ");
    await notifyParticipants(deal.id, { kind: "shipment.event", title: `${deal.reference}: ${codes}`, body: `${fresh.length} event${fresh.length === 1 ? "" : "s"} from ${provider.label}. Context only; never a release condition.`, path: `/shipments?deal=${deal.id}` });
  }
  return fresh.length;
}

export interface CarrierPollReport {
  polled: number;
  inserted: number;
  failed: number;
}

/** Reads every attached feed on live (funded) deals. One failing source never blocks the others. */
export async function pollCarriers(now: Date = new Date()): Promise<CarrierPollReport> {
  const rows = await db()
    .select({ shipment: schema.shipments, dealId: schema.deals.id, reference: schema.deals.reference })
    .from(schema.shipments)
    .innerJoin(schema.deals, eq(schema.deals.id, schema.shipments.dealId))
    .where(and(eq(schema.deals.status, "funded"), like(schema.shipments.etaSource, "carrier:%")))
    .orderBy(asc(schema.deals.reference));
  const report: CarrierPollReport = { polled: 0, inserted: 0, failed: 0 };
  for (const r of rows) {
    const provider = attachedProvider(r.shipment.etaSource);
    if (!provider) continue;
    try {
      report.inserted += await pollShipment(r.shipment, { id: r.dealId, reference: r.reference }, provider, now);
      report.polled++;
    } catch (e) {
      report.failed++;
      console.error(`[carriers] ${provider.id} poll failed for ${r.reference}`, e instanceof Error ? e.message : e);
    }
  }
  return report;
}

/** Attaches or detaches a feed. Detaching clears the ETA it supplied; recorded events stay in the log. */
export async function setCarrierProvider(session: SessionContext, dealId: string, input: z.infer<typeof carrierProviderInput>): Promise<{ provider: string | null; imported: number }> {
  const access = await dealAccess(session, dealId);
  const role = requireRole(access, "buyer", "forwarder");
  if (access.deal.status === "completed" || access.deal.status === "cancelled") throw new ApiError("ALREADY_SETTLED", "This agreement is closed; carrier feeds can no longer change.");
  const [shipment] = await db().select().from(schema.shipments).where(eq(schema.shipments.dealId, dealId));
  if (!shipment) throw new ApiError("NOT_FOUND", "No shipment on this deal.");

  const before = attachedProvider(shipment.etaSource);
  const next = input.provider ? carrierProvider(input.provider) : null;
  if ((before?.id ?? null) === (next?.id ?? null)) return { provider: next?.id ?? null, imported: 0 };

  await db().transaction(async (tx) => {
    await tx
      .update(schema.shipments)
      .set(next ? { etaSource: etaSourceFor(next.id) } : { etaSource: null, etaAt: null })
      .where(eq(schema.shipments.id, shipment.id));
    await appendAudit(tx, {
      orgId: session.org?.id,
      dealId,
      actorUserId: session.user.id,
      actorLabel: `${session.user.displayName} (${role})`,
      resourceType: "shipment",
      resourceId: shipment.id,
      action: next ? "shipment.carrier_feed_attached" : "shipment.carrier_feed_detached",
      evidence: { provider: next?.id ?? null, previous: before?.id ?? null, sourceType: next?.sourceType ?? null },
    });
  });

  if (!next || access.deal.status !== "funded") return { provider: next?.id ?? null, imported: 0 };
  // An immediate first read shows the result without waiting for the scheduler; if it fails, the scheduler retries.
  try {
    return { provider: next.id, imported: await pollShipment({ ...shipment, etaSource: etaSourceFor(next.id) }, access.deal, next, new Date()) };
  } catch (e) {
    console.error(`[carriers] first ${next.id} poll failed for ${access.deal.reference}`, e instanceof Error ? e.message : e);
    return { provider: next.id, imported: 0 };
  }
}

export interface CarrierFeedView {
  provider: { id: string; label: string; sourceType: string; confidence: string } | null;
  lastPolledAt: string | null;
  fundedAt: string | null;
  etaAt: string | null;
}

export async function carrierFeed(dealId: string): Promise<CarrierFeedView | null> {
  const [shipment] = await db().select().from(schema.shipments).where(eq(schema.shipments.dealId, dealId));
  if (!shipment) return null;
  const provider = attachedProvider(shipment.etaSource);
  const [slot] = await db().select().from(schema.schedulerState).where(eq(schema.schedulerState.name, pollSlotName(shipment.id)));
  const funded = await fundedAt(dealId);
  return {
    provider: provider ? { id: provider.id, label: provider.label, sourceType: provider.sourceType, confidence: provider.confidence } : null,
    lastPolledAt: slot?.lastRunAt.toISOString() ?? null,
    fundedAt: funded?.toISOString() ?? null,
    etaAt: shipment.etaAt?.toISOString() ?? null,
  };
}

/** Every registered feed, for the attach control. */
export function carrierProviderOptions(): { id: string; label: string }[] {
  return Object.values(CARRIER_PROVIDERS).map((p) => ({ id: p.id, label: p.label }));
}
