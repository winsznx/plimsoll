import { sql } from "drizzle-orm";
import { chainResetCheck, gateway, isChainConfigured } from "@/server/chain";
import { db, ensureMigrated } from "@/server/db/client";
import { pendingJobCount } from "@/server/jobs";

export async function GET(): Promise<Response> {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};
  try {
    await ensureMigrated();
    await db().execute(sql`select 1`);
    checks.database = { ok: true };
    checks.queue = { ok: true, detail: `${await pendingJobCount()} pending jobs` };
  } catch (e) {
    checks.database = { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
  if (!isChainConfigured()) checks.rpc = { ok: false, detail: "Chain not configured; run pnpm bootstrap:testnet" };
  else {
    try {
      checks.rpc = { ok: true, detail: `latest ledger ${await gateway().latestLedger()}` };
      checks.deployment = await chainResetCheck();
    } catch (e) {
      checks.rpc = { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }
  const ok = Object.values(checks).every((c) => c.ok);
  return Response.json({ status: ok ? "ready" : "degraded", checks }, { status: ok ? 200 : 503 });
}
