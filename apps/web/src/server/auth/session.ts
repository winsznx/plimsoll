import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { db, schema } from "../db/client";
import { env } from "../env";

export const SESSION_COOKIE = "plimsoll_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export interface SessionContext {
  sessionId: string;
  method: "passkey" | "demo" | "api_key";
  user: typeof schema.users.$inferSelect;
  org: typeof schema.organizations.$inferSelect | null;
  role: "owner" | "admin" | "member" | null;
  wallets: (typeof schema.wallets.$inferSelect)[];
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string, orgId: string | null, method: "passkey" | "demo"): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  await db().insert(schema.sessions).values({ tokenHash: hashToken(token), userId, activeOrgId: orgId, method, expiresAt: new Date(Date.now() + SESSION_TTL_MS) });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env().PLIMSOLL_ORIGIN.startsWith("https://"),
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db().delete(schema.sessions).where(eq(schema.sessions.tokenHash, hashToken(token)));
  jar.delete(SESSION_COOKIE);
}

async function buildContext(sessionId: string, method: SessionContext["method"], user: typeof schema.users.$inferSelect, activeOrgId: string | null): Promise<SessionContext> {
  let org: SessionContext["org"] = null;
  let role: SessionContext["role"] = null;
  if (activeOrgId) {
    const [m] = await db()
      .select({ org: schema.organizations, role: schema.memberships.role })
      .from(schema.memberships)
      .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.orgId))
      .where(and(eq(schema.memberships.userId, user.id), eq(schema.memberships.orgId, activeOrgId), eq(schema.memberships.status, "active")));
    if (m) {
      org = m.org;
      role = m.role;
    }
  }
  const wallets = await db().select().from(schema.wallets).where(eq(schema.wallets.userId, user.id));
  return { sessionId, method, user, org, role, wallets };
}

/**
 * Programmatic access: a sandbox key acts as the member who created it, inside that organization,
 * and only while that membership is still active.
 */
export async function apiKeySession(authorization: string | null): Promise<SessionContext | null> {
  const key = /^Bearer\s+(plm_\w+_[\w-]+)$/.exec(authorization ?? "")?.[1];
  if (!key) return null;
  const [row] = await db()
    .select({ k: schema.apiKeys, user: schema.users })
    .from(schema.apiKeys)
    .innerJoin(schema.users, eq(schema.users.id, schema.apiKeys.createdBy))
    .where(and(eq(schema.apiKeys.keyHash, hashToken(key)), isNull(schema.apiKeys.revokedAt)));
  if (!row) return null;
  await db().update(schema.apiKeys).set({ lastUsedAt: new Date() }).where(eq(schema.apiKeys.id, row.k.id));
  const ctx = await buildContext(`api_key:${row.k.prefix}`, "api_key", row.user, row.k.orgId);
  return ctx.org ? ctx : null;
}

export async function currentSession(): Promise<SessionContext | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const [row] = await db()
    .select({ session: schema.sessions, user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.tokenHash, hashToken(token)), gt(schema.sessions.expiresAt, new Date())));
  if (!row) return null;
  return buildContext(row.session.id, row.session.method, row.user, row.session.activeOrgId);
}
