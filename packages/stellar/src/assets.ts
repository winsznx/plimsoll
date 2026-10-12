import { Asset, BASE_FEE, Keypair, Operation, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import { formatAmount } from "@plimsoll/domain";
import type { EscrowGateway, SubmitResult } from "./gateway";

export interface ClassicAsset {
  code: string;
  issuer: string;
}

export function toAsset(a: ClassicAsset): Asset {
  return new Asset(a.code, a.issuer);
}

/** Classic accounts must hold a trustline before the Stellar Asset Contract can pay them. */
export async function hasTrustline(gw: EscrowGateway, account: string, asset: ClassicAsset): Promise<boolean> {
  if (account === asset.issuer) return true;
  return (await readBalance(gw, account, asset)) !== null;
}

/** Balance in token units, or 0 when the account holds no trustline. */
export async function tokenBalance(gw: EscrowGateway, account: string, asset: ClassicAsset): Promise<bigint> {
  return (await readBalance(gw, account, asset)) ?? 0n;
}

async function readBalance(gw: EscrowGateway, account: string, asset: ClassicAsset): Promise<bigint | null> {
  try {
    const res = await gw.server.getAssetBalance(account, toAsset(asset), gw.network.passphrase);
    return res.balanceEntry ? BigInt(res.balanceEntry.amount) : null;
  } catch (e) {
    if (e instanceof Error && /not found/i.test(e.message)) return null;
    throw e;
  }
}

export async function accountExists(gw: EscrowGateway, account: string): Promise<boolean> {
  try {
    await gw.server.getAccount(account);
    return true;
  } catch {
    return false;
  }
}

export async function buildChangeTrust(gw: EscrowGateway, account: string, asset: ClassicAsset): Promise<Transaction> {
  const source = await gw.server.getAccount(account);
  return new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: gw.network.passphrase })
    .addOperation(Operation.changeTrust({ asset: toAsset(asset) }))
    .setTimeout(300)
    .build();
}

export async function issuePayment(gw: EscrowGateway, issuer: Keypair, to: string, asset: ClassicAsset, units: bigint): Promise<SubmitResult> {
  const source = await gw.server.getAccount(issuer.publicKey());
  const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: gw.network.passphrase })
    .addOperation(Operation.payment({ destination: to, asset: toAsset(asset), amount: formatAmount(units, { grouping: false, minFraction: 0 }) }))
    .setTimeout(300)
    .build();
  tx.sign(issuer);
  return gw.sendAndPoll(tx);
}

export async function friendbotFund(gw: EscrowGateway, account: string): Promise<void> {
  if (!gw.network.friendbotUrl) throw new Error(`${gw.network.label} has no friendbot`);
  await gw.server.fundAddress(account, gw.network.friendbotUrl);
}
