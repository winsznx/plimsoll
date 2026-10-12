import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { appendAudit } from "../audit";
import { db, schema } from "../db/client";
import { ApiError } from "../http";
import { enqueue } from "../jobs";
import type { SessionContext } from "../auth/session";
import { OUTBOUND_EVENTS } from "./notify";

function requireAdmin(session: SessionContext): string {
  if (!session.org || (session.role !== "owner" && session.role !== "admin")) throw new ApiError("ROLE_DENIED", "Organization admins only.");
  return session.org.id;
}

export const webhookInput = z.object({
  url: z.url().refine((u) => u.startsWith("https://") || u.startsWith("http://localhost"), "Webhooks must use HTTPS."),
  events: z.array(z.enum(OUTBOUND_EVENTS)).min(1),
});

export async function createWebhook(session: SessionContext, input: z.infer<typeof webhookInput>): Promise<{ id: string; secret: string }> {
  const orgId = requireAdmin(session);
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  const [row] = await db().insert(schema.webhookEndpoints).values({ orgId, url: input.url, secret, events: input.events }).returning();
  await db().transaction((tx) => appendAudit(tx, { orgId, actorUserId: session.user.id, actorLabel: session.user.displayName, resourceType: "webhook", resourceId: row!.id, action: "integration.webhook_created", evidence: { url: input.url } }));
  return { id: row!.id, secret };
}

export async function listWebhooks(session: SessionContext) {
  if (!session.org) return [];
  const endpoints = await db().select().from(schema.webhookEndpoints).where(eq(schema.webhookEndpoints.orgId, session.org.id));
  const deliveries = endpoints.length ? await db().select().from(schema.webhookDeliveries).where(inArray(schema.webhookDeliveries.endpointId, endpoints.map((e) => e.id))).orderBy(desc(schema.webhookDeliveries.createdAt)).limit(50) : [];
  return endpoints.map((e) => ({ id: e.id, url: e.url, events: e.events, status: e.status, createdAt: e.createdAt.toISOString(), secretPreview: `${e.secret.slice(0, 10)}…`, deliveries: deliveries.filter((d) => d.endpointId === e.id).map((d) => ({ id: d.id, eventType: d.eventType, status: d.status, attempts: d.attempts, responseCode: d.responseCode, lastError: d.lastError, createdAt: d.createdAt.toISOString() })) }));
}

export async function sendTestDelivery(session: SessionContext, endpointId: string): Promise<void> {
  const orgId = requireAdmin(session);
  const [ep] = await db().select().from(schema.webhookEndpoints).where(and(eq(schema.webhookEndpoints.id, endpointId), eq(schema.webhookEndpoints.orgId, orgId)));
  if (!ep) throw new ApiError("NOT_FOUND", "Webhook not found.");
  const eventId = randomBytes(12).toString("hex");
  const [d] = await db().insert(schema.webhookDeliveries).values({ endpointId, eventId, eventType: "test.delivery", payload: { id: eventId, type: "test.delivery", createdAt: new Date().toISOString(), data: { note: "Signed test delivery from Plimsoll." } } }).returning();
  await enqueue(db(), "deliver_webhook", { deliveryId: d!.id });
}

export async function createApiKey(session: SessionContext, name: string): Promise<{ key: string; prefix: string }> {
  const orgId = requireAdmin(session);
  const key = `plm_test_${randomBytes(24).toString("base64url")}`;
  const prefix = key.slice(0, 13);
  await db().insert(schema.apiKeys).values({ orgId, name, prefix, keyHash: createHash("sha256").update(key).digest("hex"), createdBy: session.user.id });
  await db().transaction((tx) => appendAudit(tx, { orgId, actorUserId: session.user.id, actorLabel: session.user.displayName, resourceType: "api_key", resourceId: prefix, action: "integration.api_key_created", evidence: { name } }));
  return { key, prefix };
}

export async function listApiKeys(session: SessionContext) {
  if (!session.org) return [];
  const rows = await db().select().from(schema.apiKeys).where(eq(schema.apiKeys.orgId, session.org.id)).orderBy(desc(schema.apiKeys.createdAt));
  return rows.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, createdAt: k.createdAt.toISOString(), lastUsedAt: k.lastUsedAt?.toISOString() ?? null, revokedAt: k.revokedAt?.toISOString() ?? null }));
}

export async function revokeApiKey(session: SessionContext, id: string): Promise<void> {
  const orgId = requireAdmin(session);
  await db().update(schema.apiKeys).set({ revokedAt: new Date() }).where(and(eq(schema.apiKeys.id, id), eq(schema.apiKeys.orgId, orgId)));
}
