/**
 * Local development launcher. Without DATABASE_URL it serves an embedded Postgres (PGlite) over
 * the wire protocol on 127.0.0.1:54339 (override with PLIMSOLL_DEV_DB_PORT) so the app uses the same `pg` driver it uses in production.
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const ROOT = resolve(import.meta.dirname, "..");
const WEB = resolve(ROOT, "apps/web");
/** Outside apps/web: Turbopack watches the app directory and PGlite rewrites its files constantly. */
const DATA = resolve(ROOT, ".data");
const PORT = Number(process.env.PLIMSOLL_DEV_DB_PORT ?? 54339);

async function main(): Promise<void> {
  let stopDb: (() => Promise<void>) | null = null;
  const childEnv = { ...process.env };
  childEnv.OBJECT_STORE_DIR ??= resolve(DATA, "objects");

  if (!process.env.DATABASE_URL) {
    const dataDir = resolve(DATA, "pg");
    mkdirSync(dataDir, { recursive: true });
    const db = await PGlite.create(dataDir);
    const server = new PGLiteSocketServer({ db, port: PORT, host: "127.0.0.1", maxConnections: 16 });
    await server.start();
    childEnv.DATABASE_URL = `postgres://postgres@127.0.0.1:${PORT}/postgres`;
    childEnv.DB_POOL_MAX = "1";
    console.log(`[dev] embedded Postgres (PGlite) at ${childEnv.DATABASE_URL}, data in .data/pg`);
    stopDb = async () => {
      await server.stop();
      await db.close();
    };
  }

  const args = process.argv.slice(2);
  const appPort = process.env.PORT ?? "3000";
  childEnv.PLIMSOLL_ORIGIN ??= `http://localhost:${appPort}`;
  const command = args.length > 0 ? args : ["next", "dev", "--port", appPort];
  const child = spawn("pnpm", ["exec", ...command], { cwd: WEB, env: childEnv, stdio: "inherit" });

  const shutdown = async (code: number) => {
    if (stopDb) await stopDb();
    process.exit(code);
  };
  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
  child.on("exit", (code) => void shutdown(code ?? 0));
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
