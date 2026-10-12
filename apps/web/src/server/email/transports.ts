import { env } from "../env";
import type { EmailMessage } from "./index";

export interface Delivery {
  status: "sent" | "logged" | "bounced";
  providerId: string | null;
}

export type Transport = (msg: EmailMessage) => Promise<Delivery>;

export const logTransport: Transport = async (msg) => {
  // Bodies carry single-use links, so production logs get the envelope only.
  const body = process.env.NODE_ENV === "production" ? "" : `\n${msg.text}\n`;
  console.info(`[email:${msg.tag}] to=${msg.to} subject=${JSON.stringify(msg.subject)}${body}`);
  return { status: "logged", providerId: null };
};

interface CloudflareResponse {
  success?: boolean;
  errors?: { code: number; message: string }[];
  result?: { message_id?: string; delivered?: string[]; queued?: string[]; permanent_bounces?: string[]; suppressed_recipients?: string[] } | null;
}

const CLOUDFLARE_ATTEMPTS = 2;
const RETRY_DELAY_MS = 1_000;

/** Cloudflare Email Service REST API. Retries once on 429/5xx; validation and auth errors are final. */
export const cloudflareTransport: Transport = async (msg) => {
  const e = env();
  if (!e.CLOUDFLARE_ACCOUNT_ID || !e.CLOUDFLARE_EMAIL_API_TOKEN) throw new Error("EMAIL_TRANSPORT=cloudflare needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_EMAIL_API_TOKEN.");
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(e.CLOUDFLARE_ACCOUNT_ID)}/email/sending/send`;
  const body = JSON.stringify({ to: [msg.to], from: { address: e.EMAIL_FROM, name: e.EMAIL_FROM_NAME }, subject: msg.subject, text: msg.text, html: msg.html });

  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${e.CLOUDFLARE_EMAIL_API_TOKEN}`, "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const parsed = (await res.json().catch(() => ({}))) as CloudflareResponse;
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < CLOUDFLARE_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      continue;
    }
    if (!res.ok || !parsed.success || !parsed.result) {
      const detail = parsed.errors?.map((x) => `${x.code} ${x.message}`).join("; ") || res.statusText;
      throw new Error(`Cloudflare Email Service responded ${res.status}: ${detail}`);
    }
    const r = parsed.result;
    const rejected = [...(r.permanent_bounces ?? []), ...(r.suppressed_recipients ?? [])].some((a) => a.toLowerCase() === msg.to.toLowerCase());
    return { status: rejected ? "bounced" : "sent", providerId: r.message_id ?? null };
  }
};
