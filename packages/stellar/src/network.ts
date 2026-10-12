import { Networks } from "@stellar/stellar-sdk";
import type { NetworkId } from "@plimsoll/domain";

export interface NetworkConfig {
  id: NetworkId;
  label: string;
  rpcUrl: string;
  passphrase: string;
  friendbotUrl: string | null;
  explorerBase: string | null;
}

export const NETWORKS: Record<NetworkId, NetworkConfig> = {
  testnet: {
    id: "testnet",
    label: "Stellar Testnet",
    rpcUrl: "https://soroban-testnet.stellar.org",
    passphrase: Networks.TESTNET,
    friendbotUrl: "https://friendbot.stellar.org",
    explorerBase: "https://stellar.expert/explorer/testnet",
  },
  mainnet: {
    id: "mainnet",
    label: "Stellar Mainnet",
    rpcUrl: "https://mainnet.sorobanrpc.com",
    passphrase: Networks.PUBLIC,
    friendbotUrl: null,
    explorerBase: "https://stellar.expert/explorer/public",
  },
  local: {
    id: "local",
    label: "Local Quickstart",
    rpcUrl: "http://localhost:8000/soroban/rpc",
    passphrase: Networks.STANDALONE,
    friendbotUrl: "http://localhost:8000/friendbot",
    explorerBase: null,
  },
};

export function resolveNetwork(id: string | undefined, rpcOverride?: string): NetworkConfig {
  const base = NETWORKS[(id ?? "testnet") as NetworkId];
  if (!base) throw new Error(`Unknown Stellar network "${id}"`);
  return rpcOverride ? { ...base, rpcUrl: rpcOverride } : base;
}

export function explorerUrl(network: NetworkConfig, kind: "tx" | "contract" | "account", id: string): string | null {
  return network.explorerBase ? `${network.explorerBase}/${kind}/${id}` : null;
}
