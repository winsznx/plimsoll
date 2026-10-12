import { describe, expect, it } from "vitest";
import { EMAIL_VERIFICATION_TTL_MS, VERIFICATION_RESEND_COOLDOWN_MS, expiresAt, hashToken, newToken, resendWaitMs, sameEmail, tokenState } from "./tokens";

const NOW = new Date("2026-10-12T12:00:00Z");

describe("single-use tokens", () => {
  it("stores only a stable sha256 hex digest, never the token", () => {
    // #given
    const token = newToken();
    // #when
    const hash = hashToken(token);
    // #then
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashToken(token));
    expect(hash).not.toContain(token);
  });

  it("issues unique URL-safe tokens with 256 bits of entropy", () => {
    const tokens = new Set(Array.from({ length: 200 }, newToken));
    expect(tokens.size).toBe(200);
    for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("is usable until its expiry and expired from that instant on", () => {
    // #given
    const t = { expiresAt: expiresAt(EMAIL_VERIFICATION_TTL_MS, NOW), closedAt: null };
    // #then
    expect(tokenState(t, new Date(NOW.getTime() + EMAIL_VERIFICATION_TTL_MS - 1))).toBe("usable");
    expect(tokenState(t, new Date(NOW.getTime() + EMAIL_VERIFICATION_TTL_MS))).toBe("expired");
  });

  it("treats a used or withdrawn token as closed even before expiry", () => {
    const t = { expiresAt: expiresAt(EMAIL_VERIFICATION_TTL_MS, NOW), closedAt: NOW };
    expect(tokenState(t, NOW)).toBe("closed");
  });
});

describe("verification resend cooldown", () => {
  it("allows the first send and blocks a second inside the cooldown", () => {
    expect(resendWaitMs(null, NOW)).toBe(0);
    expect(resendWaitMs(new Date(NOW.getTime() - 10_000), NOW)).toBe(VERIFICATION_RESEND_COOLDOWN_MS - 10_000);
    expect(resendWaitMs(new Date(NOW.getTime() - VERIFICATION_RESEND_COOLDOWN_MS), NOW)).toBe(0);
  });
});

describe("invited email matching", () => {
  it("ignores case and surrounding whitespace but nothing else", () => {
    expect(sameEmail(" Ben@Example.test ", "ben@example.test")).toBe(true);
    expect(sameEmail("ben@example.test", "ben+x@example.test")).toBe(false);
  });
});
