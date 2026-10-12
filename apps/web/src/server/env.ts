import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().default("postgres://postgres@127.0.0.1:54339/postgres"),
  /**
   * PEM root CA for verified TLS to Postgres. Supabase signs its pooler certificate with its own
   * root, so `sslmode=require` fails Node's trust store; pinning the root keeps verify-full.
   */
  DATABASE_CA_CERT: z.string().optional(),
  /** Embedded PGlite interleaves extended-protocol messages across connections, so dev uses 1. */
  DB_POOL_MAX: z.coerce.number().int().min(1).max(64).default(8),
  STELLAR_NETWORK: z.enum(["testnet", "mainnet", "local"]).default("testnet"),
  STELLAR_RPC_URL: z.string().optional(),
  PLIMSOLL_ORIGIN: z.string().default("http://localhost:3000"),
  PLIMSOLL_RELAYER_SECRET: z.string().optional(),
  PLIMSOLL_ISSUER_SECRET: z.string().optional(),
  PLIMSOLL_ASSET_CODE: z.string().default("DEMOUSD"),
  PLIMSOLL_ASSET_ISSUER: z.string().optional(),
  PLIMSOLL_ASSET_IS_DEMO: z.enum(["true", "false"]).default("true"),
  PLIMSOLL_TOKEN_CONTRACT_ID: z.string().optional(),
  PLIMSOLL_ESCROW_WASM_HASH: z.string().optional(),
  DEMO_BUYER_SECRET: z.string().optional(),
  DEMO_SUPPLIER_SECRET: z.string().optional(),
  DEMO_INSPECTOR_SECRET: z.string().optional(),
  DEMO_FORWARDER_SECRET: z.string().optional(),
  DEMO_RESOLVER_SECRET: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  PLIMSOLL_MODEL: z.string().default("claude-opus-5-5"),
  OBJECT_STORE: z.enum(["fs", "s3"]).default("fs"),
  OBJECT_STORE_DIR: z.string().default(".data/objects"),
  S3_ENDPOINT: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  /** Supabase Storage session auth: access key = project ref, secret = anon key, token = service JWT. */
  S3_SESSION_TOKEN: z.string().optional(),
  /** Shared secret for the scheduler that calls /api/internal/tick on serverless hosts. */
  CRON_SECRET: z.string().optional(),
  RUN_WORKERS: z.enum(["true", "false"]).default("true"),
  /** log prints messages to the server console; cloudflare sends through Cloudflare Email Service. */
  EMAIL_TRANSPORT: z.enum(["log", "cloudflare"]).default("log"),
  EMAIL_FROM: z.email().default("notifications@plimsoll.localhost"),
  EMAIL_FROM_NAME: z.string().min(1).default("Plimsoll"),
  CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
  /** Account API token with the "Email Sending: Edit" permission. */
  CLOUDFLARE_EMAIL_API_TOKEN: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  cached ??= schema.parse(process.env);
  return cached;
}

/** Throws a clear setup error when testnet bootstrap has not been run. */
export function chainConfig() {
  const e = env();
  const missing = (["PLIMSOLL_RELAYER_SECRET", "PLIMSOLL_ASSET_ISSUER", "PLIMSOLL_TOKEN_CONTRACT_ID", "PLIMSOLL_ESCROW_WASM_HASH"] as const).filter((k) => !e[k]);
  if (missing.length > 0) throw new Error(`Chain not configured (${missing.join(", ")}). Run \`pnpm bootstrap:testnet\`.`);
  return {
    network: e.STELLAR_NETWORK,
    rpcUrl: e.STELLAR_RPC_URL,
    relayerSecret: e.PLIMSOLL_RELAYER_SECRET!,
    asset: { code: e.PLIMSOLL_ASSET_CODE, issuer: e.PLIMSOLL_ASSET_ISSUER!, contractId: e.PLIMSOLL_TOKEN_CONTRACT_ID!, isDemo: e.PLIMSOLL_ASSET_IS_DEMO === "true" },
    wasmHash: e.PLIMSOLL_ESCROW_WASM_HASH!,
  };
}
