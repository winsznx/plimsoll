"use client";

import { getNetworkDetails, isConnected, requestAccess, signMessage, signTransaction } from "@stellar/freighter-api";

export class WalletError extends Error {}

async function ensureFreighter(): Promise<void> {
  const c = await isConnected();
  if (c.error || !c.isConnected) throw new WalletError("Freighter is not installed. Install it from freighter.app, or use a demo persona.");
}

export async function connectFreighter(expectedPassphrase: string): Promise<string> {
  await ensureFreighter();
  const access = await requestAccess();
  if (access.error) throw new WalletError(access.error.message ?? "Wallet access was declined.");
  const net = await getNetworkDetails();
  if (net.error) throw new WalletError(net.error.message ?? "Could not read wallet network.");
  if (net.networkPassphrase !== expectedPassphrase) throw new WalletError(`Freighter is on ${net.network}. Switch it to the network this deal uses before signing.`);
  return access.address;
}

/** Signs exactly the reviewed transaction; the server rejects anything whose hash differs. */
export async function signWithFreighter(xdr: string, networkPassphrase: string, address: string): Promise<string> {
  await ensureFreighter();
  const res = await signTransaction(xdr, { networkPassphrase, address });
  if (res.error) throw new WalletError(res.error.message ?? "Signing was declined.");
  return res.signedTxXdr;
}

export async function signLinkMessage(message: string, networkPassphrase: string, address: string): Promise<string> {
  await ensureFreighter();
  const res = await signMessage(message, { networkPassphrase, address });
  if (res.error || !res.signedMessage) throw new WalletError(res.error?.message ?? "Message signing was declined.");
  return typeof res.signedMessage === "string" ? res.signedMessage : res.signedMessage.toString("base64");
}
