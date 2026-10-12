import { createHash, randomBytes } from "node:crypto";

export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export const ORG_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;

/** 32 random bytes, URL-safe. Only its hash is ever stored. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function expiresAt(ttlMs: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + ttlMs);
}

export interface SingleUseToken {
  expiresAt: Date;
  /** When the token was used, accepted or withdrawn; any of these ends it. */
  closedAt: Date | null;
}

export function tokenState(t: SingleUseToken, now: Date = new Date()): "usable" | "expired" | "closed" {
  if (t.closedAt) return "closed";
  return t.expiresAt.getTime() > now.getTime() ? "usable" : "expired";
}

/** Milliseconds left before another verification email may be sent; 0 when allowed now. */
export function resendWaitMs(lastSentAt: Date | null, now: Date = new Date()): number {
  if (!lastSentAt) return 0;
  return Math.max(0, lastSentAt.getTime() + VERIFICATION_RESEND_COOLDOWN_MS - now.getTime());
}

export function sameEmail(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
