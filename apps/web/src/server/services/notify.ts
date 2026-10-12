import { createHmac, randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "../db/client";
import { send } from "../email";
import { notificationEmail } from "../email/messages";
import { enqueue } from "../jobs";

export const OUTBOUND_EVENTS = [
  "deal.accepted",
  "escrow.funded.confirmed",
  "document.analysis.completed",
  "document.discrepancy.opened",
  "milestone.approval.confirmed",
  "milestone.release.confirmed",
  "dispute.opened",
  "dispute.resolved",
  "refund.confirmed",
] as const;
export type OutboundEvent = (typeof OUTBOUND_EVENTS)[number];

interface NotificationInput {
  kind: string;
  title: string;
  /** Never include document contents or other sensitive payloads; notifications only point. */
  body: string;
  path: string;
}

/**
 * In-app notification for every linked participant except the actor, plus an email (title and
 * link only) to those who opted in and verified their address.
 */
export async function notifyParticipants(dealId: string, n: NotificationInput, exceptUserId?: string): Promise<void> {
  const parts = await db().select().from(schema.dealParticipants).where(and(eq(schema.dealParticipants.dealId, dealId), isNotNull(schema.dealParticipants.userId)));
  const [deal] = await db().select().from(schema.deals).where(eq(schema.deals.id, dealId));
  const orgIds = [deal?.buyerOrgId, deal?.supplierOrgId].filter((x): x is string => Boolean(x));
  const members = orgIds.length ? await db().select().from(schema.memberships).where(and(inArray(schema.memberships.orgId, orgIds), eq(schema.memberships.status, "active"))) : [];
  const userIds = new Set([...parts.map((p) => p.userId!), ...members.map((m) => m.userId)]);
  if (exceptUserId) userIds.delete(exceptUserId);
  if (userIds.size === 0) return;
  await db().insert(schema.notifications).values([...userIds].map((userId) => ({ userId, dealId, kind: n.kind, title: n.title, body: n.body, href: n.path })));
  const recipients = await db()
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(and(inArray(schema.users.id, [...userIds]), eq(schema.users.emailNotifications, true), eq(schema.users.isDemo, false), isNotNull(schema.users.emailVerifiedAt)));
  await Promise.all(recipients.map((r) => send(notificationEmail(r.email, n.title, n.path))));
}

/** Queues signed webhook deliveries for orgs on the deal that subscribed to the event. */
export async function emitWebhook(dealId: string, event: OutboundEvent, data: Record<string, unknown>): Promise<void> {
  const [deal] = await db().select().from(schema.deals).where(eq(schema.deals.id, dealId));
  if (!deal) return;
  const orgIds = [deal.buyerOrgId, deal.supplierOrgId].filter((x): x is string => Boolean(x));
  const endpoints = await db().select().from(schema.webhookEndpoints).where(and(inArray(schema.webhookEndpoints.orgId, orgIds), eq(schema.webhookEndpoints.status, "active")));
  const eventId = randomUUID();
  for (const ep of endpoints.filter((e) => e.events.includes(event))) {
    const [delivery] = await db()
      .insert(schema.webhookDeliveries)
      .values({ endpointId: ep.id, eventId, eventType: event, payload: { id: eventId, type: event, createdAt: new Date().toISOString(), data: { dealId, reference: deal.reference, ...data } } })
      .returning();
    await enqueue(db(), "deliver_webhook", { deliveryId: delivery!.id });
  }
}

export function signWebhook(secret: string, timestamp: string, eventId: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${eventId}.${body}`).digest("hex");
}

export async function deliverWebhook(deliveryId: string): Promise<void> {
  const [row] = await db()
    .select({ d: schema.webhookDeliveries, ep: schema.webhookEndpoints })
    .from(schema.webhookDeliveries)
    .innerJoin(schema.webhookEndpoints, eq(schema.webhookEndpoints.id, schema.webhookDeliveries.endpointId))
    .where(eq(schema.webhookDeliveries.id, deliveryId));
  if (!row || row.d.status === "delivered") return;
  const body = JSON.stringify(row.d.payload);
  const ts = Math.floor(Date.now() / 1000).toString();
  const signature = signWebhook(row.ep.secret, ts, row.d.eventId, body);
  let status = 0;
  try {
    const res = await fetch(row.ep.url, {
      method: "POST",
      headers: { "content-type": "application/json", "plimsoll-event-id": row.d.eventId, "plimsoll-timestamp": ts, "plimsoll-signature": `v1=${signature}` },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    status = res.status;
  } catch (e) {
    await db().update(schema.webhookDeliveries).set({ attempts: row.d.attempts + 1, lastError: e instanceof Error ? e.message : String(e) }).where(eq(schema.webhookDeliveries.id, deliveryId));
    throw e;
  }
  const ok = status >= 200 && status < 300;
  await db()
    .update(schema.webhookDeliveries)
    .set({ attempts: row.d.attempts + 1, responseCode: status, status: ok ? "delivered" : "pending", deliveredAt: ok ? new Date() : null })
    .where(eq(schema.webhookDeliveries.id, deliveryId));
  if (!ok) throw new Error(`Webhook endpoint responded ${status}`);
}
