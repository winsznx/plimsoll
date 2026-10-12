import { randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { Keypair } from "@stellar/stellar-sdk";
import { accountExists, buildChangeTrust, hasTrustline, issuePayment, tokenBalance } from "@plimsoll/stellar";
import { appendAudit } from "../audit";
import { gateway, issuerKeypair, network } from "../chain";
import { db, schema } from "../db/client";
import { chainConfig } from "../env";
import { ApiError } from "../http";
import { assertFaucetQuota } from "../quotas";
import type { SessionContext } from "../auth/session";
import { linkWalletOwners } from "./deals";

const LINK_TTL_MS = 5 * 60 * 1000;

/** A one-time message the wallet signs (SEP-53 style) to prove control of the address. */
export async function walletLinkChallenge(session: SessionContext, address: string): Promise<{ message: string }> {
  const nonce = randomBytes(16).toString("hex");
  const message = `Plimsoll wallet link\nAccount: ${session.user.email}\nAddress: ${address}\nNetwork: ${network().passphrase}\nNonce: ${nonce}`;
  await db().insert(schema.authChallenges).values({ challenge: message, purpose: "authentication", userId: session.user.id, expiresAt: new Date(Date.now() + LINK_TTL_MS) });
  return { message };
}

export async function linkWallet(session: SessionContext, input: { address: string; message: string; signature: string }): Promise<void> {
  const [row] = await db()
    .delete(schema.authChallenges)
    .where(and(eq(schema.authChallenges.challenge, input.message), eq(schema.authChallenges.userId, session.user.id), gt(schema.authChallenges.expiresAt, new Date())))
    .returning();
  if (!row || !input.message.includes(`Address: ${input.address}`)) throw new ApiError("SIGNATURE_EXPIRED", "Wallet link request expired or does not match.");
  let valid = false;
  try {
    valid = Keypair.fromPublicKey(input.address).verifyMessage(input.message, Buffer.from(input.signature, "base64"));
  } catch {
    valid = false;
  }
  if (!valid) throw new ApiError("ROLE_DENIED", "The wallet signature does not prove control of this address.");
  const [taken] = await db().select().from(schema.wallets).where(and(eq(schema.wallets.address, input.address), eq(schema.wallets.network, network().id)));
  if (taken && taken.userId !== session.user.id) throw new ApiError("ROLE_DENIED", "This address is linked to another account.");
  await db().transaction(async (tx) => {
    if (!taken) await tx.insert(schema.wallets).values({ userId: session.user.id, address: input.address, network: network().id, accountKind: "external", label: "Freighter", verifiedAt: new Date() });
    await appendAudit(tx, { orgId: session.org?.id, actorUserId: session.user.id, actorLabel: session.user.displayName, resourceType: "wallet", resourceId: input.address, action: "wallet.linked", evidence: { network: network().id } });
    const parts = await tx.select().from(schema.dealParticipants).where(eq(schema.dealParticipants.signingAddress, input.address));
    for (const p of parts) await linkWalletOwners(tx, p.dealId);
  });
}

export async function walletStatus(address: string) {
  const cfg = chainConfig();
  const gw = gateway();
  const exists = await accountExists(gw, address);
  if (!exists) return { exists, trustline: false, balance: "0", asset: cfg.asset };
  return { exists, trustline: await hasTrustline(gw, address, cfg.asset), balance: String(await tokenBalance(gw, address, cfg.asset)), asset: cfg.asset };
}

export async function prepareTrustline(session: SessionContext, address: string): Promise<{ xdr: string; networkPassphrase: string }> {
  if (!session.wallets.some((w) => w.address === address)) throw new ApiError("ROLE_DENIED", "Link this wallet first.");
  const tx = await buildChangeTrust(gateway(), address, chainConfig().asset);
  return { xdr: tx.toXDR(), networkPassphrase: network().passphrase };
}

export async function submitClassic(session: SessionContext, signedXdr: string): Promise<{ txHash: string }> {
  const { TransactionBuilder } = await import("@stellar/stellar-sdk");
  const tx = TransactionBuilder.fromXDR(signedXdr, network().passphrase);
  if ("innerTransaction" in tx) throw new ApiError("VALIDATION_FAILED", "Fee-bump transactions are not accepted here.");
  if (!session.wallets.some((w) => w.address === tx.source)) throw new ApiError("ROLE_DENIED", "Transaction source is not one of your wallets.");
  if (tx.operations.length !== 1 || tx.operations[0]!.type !== "changeTrust") throw new ApiError("VALIDATION_FAILED", "Only a single trustline operation can be submitted here.");
  const res = await gateway().sendAndPoll(tx);
  return { txHash: res.hash };
}

/** Testnet faucet for the demo asset. Refuses on mainnet and when the asset is real USDC. */
export async function requestDemoTokens(session: SessionContext, address: string, units: bigint): Promise<{ txHash: string }> {
  const cfg = chainConfig();
  const issuer = issuerKeypair();
  if (!cfg.asset.isDemo || !issuer) throw new ApiError("TOKEN_NOT_ALLOWLISTED", "The faucet only exists for the testnet demo token.");
  if (!session.wallets.some((w) => w.address === address)) throw new ApiError("ROLE_DENIED", "Link this wallet first.");
  if (!(await hasTrustline(gateway(), address, cfg.asset))) throw new ApiError("TRUSTLINE_MISSING", `Add a ${cfg.asset.code} trustline first.`);
  await assertFaucetQuota(session);
  const res = await issuePayment(gateway(), issuer, address, cfg.asset, units);
  await db().transaction((tx) => appendAudit(tx, { orgId: session.org?.id, actorUserId: session.user.id, actorLabel: session.user.displayName, resourceType: "wallet", resourceId: address, action: "wallet.demo_tokens_issued", source: "chain", evidence: { txHash: res.hash, units: String(units) } }));
  return { txHash: res.hash };
}
