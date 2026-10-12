import { and, eq, gt } from "drizzle-orm";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { appendAudit } from "../audit";
import { db, schema } from "../db/client";
import { env } from "../env";
import { ApiError } from "../http";
import { createVerification, sendVerification } from "../services/email-verification";
import { createSession } from "./session";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

function rp() {
  const origin = env().PLIMSOLL_ORIGIN;
  return { origin, rpID: new URL(origin).hostname, rpName: "Plimsoll" };
}

export async function registrationOptions(input: { email: string; displayName: string; orgLegalName: string; jurisdiction: string }): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const [existing] = await db().select().from(schema.users).where(eq(schema.users.email, input.email.toLowerCase()));
  if (existing) throw new ApiError("VALIDATION_FAILED", "An account with this email already exists. Sign in with your passkey.");
  const { rpID, rpName } = rp();
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: input.email.toLowerCase(),
    userDisplayName: input.displayName,
    attestationType: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });
  await db().insert(schema.authChallenges).values({
    challenge: options.challenge,
    purpose: "registration",
    pendingEmail: input.email.toLowerCase(),
    pendingName: input.displayName,
    pendingOrg: { legalName: input.orgLegalName, jurisdiction: input.jurisdiction },
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
  });
  return options;
}

async function consumeChallenge(challenge: string, purpose: "registration" | "authentication") {
  const [row] = await db()
    .delete(schema.authChallenges)
    .where(and(eq(schema.authChallenges.challenge, challenge), eq(schema.authChallenges.purpose, purpose), gt(schema.authChallenges.expiresAt, new Date())))
    .returning();
  if (!row) throw new ApiError("SIGNATURE_EXPIRED", "This sign-in request expired. Start again.");
  return row;
}

function clientChallenge(response: { response: { clientDataJSON: string } }): string {
  const data = JSON.parse(Buffer.from(response.response.clientDataJSON, "base64url").toString("utf8")) as { challenge?: string };
  if (!data.challenge) throw new ApiError("VALIDATION_FAILED", "Malformed passkey response.");
  return data.challenge;
}

/**
 * Creates the user, their organization (unverified) and the passkey, signs them in, and emails a
 * verification link. The account is usable before verification, but deals stay locked until then.
 */
export async function verifyRegistration(response: RegistrationResponseJSON): Promise<{ userId: string; orgId: string }> {
  const challenge = await consumeChallenge(clientChallenge(response), "registration");
  const { origin, rpID } = rp();
  const verification = await verifyRegistrationResponse({ response, expectedChallenge: challenge.challenge, expectedOrigin: origin, expectedRPID: rpID });
  if (!verification.verified) throw new ApiError("ROLE_DENIED", "Passkey registration could not be verified.");
  const cred = verification.registrationInfo.credential;

  const result = await db().transaction(async (tx) => {
    const [user] = await tx.insert(schema.users).values({ email: challenge.pendingEmail!, displayName: challenge.pendingName! }).returning();
    const [org] = await tx.insert(schema.organizations).values({ legalName: challenge.pendingOrg!.legalName, displayName: challenge.pendingOrg!.legalName, jurisdiction: challenge.pendingOrg!.jurisdiction }).returning();
    await tx.insert(schema.memberships).values({ orgId: org!.id, userId: user!.id, role: "owner" });
    await tx.insert(schema.passkeys).values({ userId: user!.id, credentialId: cred.id, publicKey: cred.publicKey, counter: cred.counter, transports: cred.transports ?? [] });
    await appendAudit(tx, { orgId: org!.id, actorUserId: user!.id, actorLabel: user!.displayName, resourceType: "user", resourceId: user!.id, action: "auth.passkey_registered", evidence: { credentialId: cred.id } });
    const verifyToken = await createVerification(tx, user!);
    return { userId: user!.id, orgId: org!.id, user: user!, verifyToken };
  });
  await createSession(result.userId, result.orgId, "passkey");
  await sendVerification(result.user, result.verifyToken);
  return { userId: result.userId, orgId: result.orgId };
}

export async function authenticationOptions(): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const options = await generateAuthenticationOptions({ rpID: rp().rpID, userVerification: "preferred" });
  await db().insert(schema.authChallenges).values({ challenge: options.challenge, purpose: "authentication", expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) });
  return options;
}

export async function verifyAuthentication(response: AuthenticationResponseJSON): Promise<{ userId: string }> {
  const challenge = await consumeChallenge(clientChallenge(response), "authentication");
  const [pk] = await db().select().from(schema.passkeys).where(eq(schema.passkeys.credentialId, response.id));
  if (!pk) throw new ApiError("UNAUTHENTICATED", "This passkey is not registered with Plimsoll.");
  const { origin, rpID } = rp();
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: { id: pk.credentialId, publicKey: pk.publicKey as Uint8Array<ArrayBuffer>, counter: pk.counter, transports: pk.transports as AuthenticatorTransport[] },
  });
  if (!verification.verified) throw new ApiError("UNAUTHENTICATED", "Passkey could not be verified.");
  await db().update(schema.passkeys).set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() }).where(eq(schema.passkeys.id, pk.id));
  const [membership] = await db().select().from(schema.memberships).where(and(eq(schema.memberships.userId, pk.userId), eq(schema.memberships.status, "active"))).limit(1);
  await createSession(pk.userId, membership?.orgId ?? null, "passkey");
  return { userId: pk.userId };
}
