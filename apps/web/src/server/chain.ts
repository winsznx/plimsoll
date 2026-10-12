import { Keypair } from "@stellar/stellar-sdk";
import { EscrowGateway, explorerUrl, resolveNetwork, type NetworkConfig } from "@plimsoll/stellar";
import { chainConfig, env } from "./env";

const globalForChain = globalThis as unknown as { plimsollGateway?: EscrowGateway };

export function gateway(): EscrowGateway {
  if (!globalForChain.plimsollGateway) {
    const cfg = chainConfig();
    globalForChain.plimsollGateway = new EscrowGateway(resolveNetwork(cfg.network, cfg.rpcUrl), Keypair.fromSecret(cfg.relayerSecret));
  }
  return globalForChain.plimsollGateway;
}

export function network(): NetworkConfig {
  const e = env();
  return resolveNetwork(e.STELLAR_NETWORK, e.STELLAR_RPC_URL);
}

export function explorer(kind: "tx" | "contract" | "account", id: string): string | null {
  return explorerUrl(network(), kind, id);
}

export function isChainConfigured(): boolean {
  try {
    chainConfig();
    return true;
  } catch {
    return false;
  }
}

export const DEMO_PERSONA_KEYS = ["BUYER", "SUPPLIER", "INSPECTOR", "FORWARDER", "RESOLVER"] as const;
export type DemoPersonaKey = (typeof DEMO_PERSONA_KEYS)[number];

/**
 * Testnet-only custodial keys for seeded demo personas. They exist so reviewers can run the
 * full flow without a wallet extension; every UI surface labels them as demo custody.
 */
export function demoKeypair(persona: DemoPersonaKey): Keypair | null {
  if (env().STELLAR_NETWORK === "mainnet") return null;
  const secret = env()[`DEMO_${persona}_SECRET`];
  return secret ? Keypair.fromSecret(secret) : null;
}

export function custodialKeypairFor(address: string): Keypair | null {
  for (const p of DEMO_PERSONA_KEYS) {
    const kp = demoKeypair(p);
    if (kp?.publicKey() === address) return kp;
  }
  return null;
}

export function issuerKeypair(): Keypair | null {
  const secret = env().PLIMSOLL_ISSUER_SECRET;
  return secret && env().STELLAR_NETWORK !== "mainnet" ? Keypair.fromSecret(secret) : null;
}

/**
 * Testnet is periodically reset, which deletes the uploaded escrow code, the asset contract and
 * every deal escrow. Detects that so operators see "re-run bootstrap" instead of opaque failures.
 */
export async function chainResetCheck(): Promise<{ ok: boolean; detail: string }> {
  const cfg = chainConfig();
  try {
    await gateway().server.getContractWasmByHash(cfg.wasmHash, "hex");
  } catch {
    return { ok: false, detail: `Escrow wasm ${cfg.wasmHash.slice(0, 12)}… is not on ${network().label}. If the network was reset, run \`pnpm bootstrap:testnet\` and delete .data to reseed.` };
  }
  try {
    await gateway().server.getContractInstance(cfg.asset.contractId);
  } catch {
    return { ok: false, detail: `Asset contract ${cfg.asset.contractId.slice(0, 12)}… is missing. Re-run \`pnpm bootstrap:testnet\`.` };
  }
  return { ok: true, detail: "escrow wasm and asset contract present" };
}
