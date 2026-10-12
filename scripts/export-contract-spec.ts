/**
 * Exports the TradeEscrow contract spec (its ABI, embedded in the wasm) to
 * packages/stellar/src/generated/trade-escrow.spec.json. `--check` fails if the committed
 * copy no longer matches the built contract, so client encoding can never silently drift.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { contract } from "@stellar/stellar-sdk";

const ROOT = resolve(import.meta.dirname, "..");
const WASM = resolve(ROOT, "contracts/target/wasm32v1-none/release/plimsoll_trade_escrow.wasm");
const OUT = resolve(ROOT, "packages/stellar/src/generated/trade-escrow.spec.json");

if (!existsSync(WASM)) {
  console.error(`Missing ${WASM}. Run \`pnpm build:contract\` first.`);
  process.exit(1);
}
const wasm = readFileSync(WASM);
const spec = contract.Spec.fromWasm(wasm);
const entries = spec.entries.map((e) => e.toXDR("base64"));
const body = `${JSON.stringify({ contract: "plimsoll-trade-escrow", specSha256: createHash("sha256").update(entries.join("\n")).digest("hex"), entries }, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const committed = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (committed !== body) {
    console.error("Contract spec drifted from packages/stellar/src/generated/trade-escrow.spec.json. Run `pnpm contract:spec`.");
    process.exit(1);
  }
  console.log("Contract spec matches the built wasm.");
} else {
  writeFileSync(OUT, body);
  console.log(`Wrote ${entries.length} spec entries to ${OUT}`);
}
