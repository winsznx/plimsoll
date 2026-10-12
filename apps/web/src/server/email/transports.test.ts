import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { EmailMessage } from "./index";
import { cloudflareTransport } from "./transports";

const msg: EmailMessage = { to: "ben@example.test", subject: "Hello", text: "t", html: "<p>t</p>", tag: "notification" };

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeAll(() => {
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct123";
  process.env.CLOUDFLARE_EMAIL_API_TOKEN = "tok";
  process.env.EMAIL_FROM = "notifications@plimsoll.example";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Cloudflare Email Service transport", () => {
  it("posts the REST shape with address-style from and returns the message id", async () => {
    // #given
    const fetchMock = vi.fn().mockResolvedValue(reply(200, { success: true, errors: [], result: { message_id: "m-1", delivered: [msg.to], permanent_bounces: [], queued: [] } }));
    vi.stubGlobal("fetch", fetchMock);
    // #when
    const delivery = await cloudflareTransport(msg);
    // #then
    expect(delivery).toEqual({ status: "sent", providerId: "m-1" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acct123/email/sending/send");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body as string)).toMatchObject({ to: [msg.to], from: { address: "notifications@plimsoll.example", name: "Plimsoll" }, subject: "Hello", text: "t", html: "<p>t</p>" });
  });

  it("reports a permanent bounce or suppression as bounced", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(200, { success: true, result: { message_id: "m-2", delivered: [], permanent_bounces: [], suppressed_recipients: ["BEN@example.test"] } })));
    expect(await cloudflareTransport(msg)).toEqual({ status: "bounced", providerId: "m-2" });
  });

  it("retries once on 429 and then succeeds", async () => {
    // #given
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(429, { success: false, errors: [{ code: 10000, message: "rate limited" }] })).mockResolvedValueOnce(reply(200, { success: true, result: { message_id: "m-3", delivered: [msg.to] } }));
    vi.stubGlobal("fetch", fetchMock);
    // #when
    const pending = cloudflareTransport(msg);
    await vi.runAllTimersAsync();
    // #then
    expect(await pending).toEqual({ status: "sent", providerId: "m-3" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a validation error and surfaces Cloudflare's message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(400, { success: false, errors: [{ code: 1000, message: "Sender domain not verified" }], result: null }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(cloudflareTransport(msg)).rejects.toThrow(/400: 1000 Sender domain not verified/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
