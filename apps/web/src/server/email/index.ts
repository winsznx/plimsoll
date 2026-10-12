import { eq } from "drizzle-orm";
import { db, schema } from "../db/client";
import { env } from "../env";
import { cloudflareTransport, logTransport, type Delivery } from "./transports";

export type EmailTag = "email.verify" | "deal.invite" | "org.invite" | "notification";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  tag: EmailTag;
}

export interface SendResult {
  outboxId: string;
  status: Delivery["status"] | "failed";
}

/**
 * Sends one message and records the attempt in email_outbox (envelope only, never the body).
 * Never throws: email is a side channel, so a delivery failure is recorded and reported to the
 * caller instead of undoing the action that triggered it. Must not be called inside a
 * transaction callback, because it writes through its own connection.
 */
export async function send(msg: EmailMessage): Promise<SendResult> {
  const transport = env().EMAIL_TRANSPORT;
  const message = { ...msg, subject: msg.subject.replace(/[\r\n]+/g, " ").slice(0, 200) };
  const [row] = await db().insert(schema.emailOutbox).values({ to: message.to, subject: message.subject, tag: message.tag, transport }).returning({ id: schema.emailOutbox.id });
  const outboxId = row!.id;
  try {
    const delivery = await (transport === "cloudflare" ? cloudflareTransport : logTransport)(message);
    await db().update(schema.emailOutbox).set({ status: delivery.status, providerId: delivery.providerId }).where(eq(schema.emailOutbox.id, outboxId));
    return { outboxId, status: delivery.status };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[email:${message.tag}] delivery failed for outbox ${outboxId}: ${error}`);
    await db().update(schema.emailOutbox).set({ status: "failed", error: error.slice(0, 2000) }).where(eq(schema.emailOutbox.id, outboxId));
    return { outboxId, status: "failed" };
  }
}
