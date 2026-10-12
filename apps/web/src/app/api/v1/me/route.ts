import { eq } from "drizzle-orm";
import { z } from "zod";
import { appendAudit } from "@/server/audit";
import { db, schema } from "@/server/db/client";
import { parseBody, route } from "@/server/http";

export const GET = route(async ({ session }) => ({
  user: {
    id: session.user.id,
    email: session.user.email,
    displayName: session.user.displayName,
    isDemo: session.user.isDemo,
    emailVerified: session.user.emailVerifiedAt !== null,
    emailNotifications: session.user.emailNotifications,
  },
  org: session.org ? { id: session.org.id, legalName: session.org.legalName, verificationState: session.org.verificationState } : null,
  role: session.role,
  method: session.method,
  wallets: session.wallets.map((w) => ({ address: w.address, network: w.network, accountKind: w.accountKind, label: w.label })),
}));

export const PATCH = route(async ({ req, session }) => {
  const { emailNotifications } = await parseBody(req, z.object({ emailNotifications: z.boolean() }));
  await db().transaction(async (tx) => {
    await tx.update(schema.users).set({ emailNotifications }).where(eq(schema.users.id, session.user.id));
    await appendAudit(tx, { orgId: session.org?.id, actorUserId: session.user.id, actorLabel: session.user.displayName, resourceType: "user", resourceId: session.user.id, action: "user.email_notifications_changed", evidence: { emailNotifications } });
  });
  return { emailNotifications };
});
