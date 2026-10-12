import { and, desc, eq, isNull } from "drizzle-orm";
import { appendAudit } from "../audit";
import { EMAIL_VERIFICATION_TTL_MS, expiresAt, hashToken, newToken, resendWaitMs, tokenState } from "../auth/tokens";
import type { SessionContext } from "../auth/session";
import { db, schema, type Db, type Tx } from "../db/client";
import { send, type SendResult } from "../email";
import { verificationEmail } from "../email/messages";
import { ApiError } from "../http";

type User = typeof schema.users.$inferSelect;

export function assertEmailVerified(session: SessionContext): void {
  if (!session.user.emailVerifiedAt) throw new ApiError("ROLE_DENIED", "Verify your email first. Use the link we sent you, or resend it from Settings.");
}

/** Supersedes any open link for the user and stores a fresh one. Returns the raw token for the email. */
export async function createVerification(conn: Db | Tx, user: Pick<User, "id" | "email">): Promise<string> {
  const token = newToken();
  const now = new Date();
  await conn.update(schema.emailVerifications).set({ consumedAt: now }).where(and(eq(schema.emailVerifications.userId, user.id), isNull(schema.emailVerifications.consumedAt)));
  await conn.insert(schema.emailVerifications).values({ userId: user.id, email: user.email, tokenHash: hashToken(token), expiresAt: expiresAt(EMAIL_VERIFICATION_TTL_MS, now) });
  return token;
}

export function sendVerification(user: Pick<User, "email" | "displayName">, token: string): Promise<SendResult> {
  return send(verificationEmail(user.email, user.displayName, token));
}

export async function resendVerification(session: SessionContext): Promise<{ alreadyVerified: boolean; delivery: SendResult["status"] | null }> {
  if (session.user.emailVerifiedAt) return { alreadyVerified: true, delivery: null };
  const [last] = await db().select({ createdAt: schema.emailVerifications.createdAt }).from(schema.emailVerifications).where(eq(schema.emailVerifications.userId, session.user.id)).orderBy(desc(schema.emailVerifications.createdAt)).limit(1);
  const wait = resendWaitMs(last?.createdAt ?? null);
  if (wait > 0) throw new ApiError("VALIDATION_FAILED", `A link was sent moments ago. Try again in ${Math.ceil(wait / 1000)} seconds.`);
  const token = await db().transaction(async (tx) => {
    const t = await createVerification(tx, session.user);
    await appendAudit(tx, { orgId: session.org?.id, actorUserId: session.user.id, actorLabel: session.user.displayName, resourceType: "user", resourceId: session.user.id, action: "auth.email_verification_sent" });
    return t;
  });
  const result = await sendVerification(session.user, token);
  return { alreadyVerified: false, delivery: result.status };
}

async function findVerification(token: string) {
  const [row] = await db()
    .select({ v: schema.emailVerifications, user: schema.users })
    .from(schema.emailVerifications)
    .innerJoin(schema.users, eq(schema.users.id, schema.emailVerifications.userId))
    .where(eq(schema.emailVerifications.tokenHash, hashToken(token)));
  return row ?? null;
}

export type VerificationPreview = { state: "usable"; email: string } | { state: "expired" | "closed" | "unknown" | "verified" };

/** Read-only, so mail scanners that prefetch the link cannot verify on the user's behalf. */
export async function verificationPreview(token: string): Promise<VerificationPreview> {
  const row = await findVerification(token);
  if (!row) return { state: "unknown" };
  if (row.user.emailVerifiedAt) return { state: "verified" };
  const state = tokenState({ expiresAt: row.v.expiresAt, closedAt: row.v.consumedAt });
  return state === "usable" ? { state, email: row.v.email } : { state };
}

export async function confirmEmail(token: string): Promise<{ email: string }> {
  const row = await findVerification(token);
  if (!row) throw new ApiError("NOT_FOUND", "This verification link is invalid.");
  if (row.user.emailVerifiedAt) return { email: row.user.email };
  const state = tokenState({ expiresAt: row.v.expiresAt, closedAt: row.v.consumedAt });
  if (state !== "usable") throw new ApiError("SIGNATURE_EXPIRED", state === "expired" ? "This verification link expired. Request a new one from Settings." : "This verification link was replaced by a newer one. Use the latest email.");
  // The address may have changed since the link was issued; only the address it was sent to is proven.
  if (row.v.email.toLowerCase() !== row.user.email.toLowerCase()) throw new ApiError("SIGNATURE_EXPIRED", "This link was issued for a different address. Request a new one from Settings.");
  const now = new Date();
  await db().transaction(async (tx) => {
    await tx.update(schema.emailVerifications).set({ consumedAt: now }).where(eq(schema.emailVerifications.id, row.v.id));
    await tx.update(schema.users).set({ emailVerifiedAt: now }).where(eq(schema.users.id, row.user.id));
    await appendAudit(tx, { actorUserId: row.user.id, actorLabel: row.user.displayName, resourceType: "user", resourceId: row.user.id, action: "auth.email_verified", evidence: { email: row.user.email } });
  });
  return { email: row.user.email };
}
