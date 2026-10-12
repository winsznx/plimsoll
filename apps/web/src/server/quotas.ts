import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { db, schema } from "./db/client";
import { ApiError } from "./http";
import type { SessionContext } from "./auth/session";

/**
 * The relayer pays every network fee, so sponsored work is metered per user and per
 * organization (PRD §8.2 "relayer fund drain"). Demo personas share generous limits.
 */
const LIMITS = {
  sponsoredPerUserPerHour: 120,
  deploysPerOrgPerDay: 25,
  faucetPerUserPerDay: 3,
} as const;

const HOUR = 60 * 60 * 1000;

async function countTx(where: ReturnType<typeof and>): Promise<number> {
  const [row] = await db().select({ n: sql<number>`count(*)::int` }).from(schema.chainTransactions).where(where);
  return row?.n ?? 0;
}

export async function assertSponsorQuota(session: SessionContext): Promise<void> {
  const n = await countTx(and(eq(schema.chainTransactions.actorUserId, session.user.id), gt(schema.chainTransactions.createdAt, new Date(Date.now() - HOUR)), inArray(schema.chainTransactions.status, ["pending", "confirmed", "failed"])));
  if (n >= LIMITS.sponsoredPerUserPerHour) throw new ApiError("ROLE_DENIED", `Sponsored transaction limit reached (${LIMITS.sponsoredPerUserPerHour} per hour). Try again later.`);
}

export async function assertDeployQuota(session: SessionContext): Promise<void> {
  if (!session.org) return;
  const orgId = session.org.id;
  const [row] = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.chainTransactions)
    .innerJoin(schema.deals, eq(schema.deals.id, schema.chainTransactions.dealId))
    .where(and(eq(schema.chainTransactions.kind, "deploy"), eq(schema.deals.buyerOrgId, orgId), gt(schema.chainTransactions.createdAt, new Date(Date.now() - 24 * HOUR))));
  if ((row?.n ?? 0) >= LIMITS.deploysPerOrgPerDay) throw new ApiError("ROLE_DENIED", `Escrow deployment limit reached (${LIMITS.deploysPerOrgPerDay} per organization per day).`);
}

export async function assertFaucetQuota(session: SessionContext): Promise<void> {
  const [row] = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.auditEvents)
    .where(and(eq(schema.auditEvents.actorUserId, session.user.id), eq(schema.auditEvents.action, "wallet.demo_tokens_issued"), gt(schema.auditEvents.createdAt, new Date(Date.now() - 24 * HOUR))));
  if ((row?.n ?? 0) >= LIMITS.faucetPerUserPerDay) throw new ApiError("ROLE_DENIED", `Demo token faucet limit reached (${LIMITS.faucetPerUserPerDay} per day).`);
}
