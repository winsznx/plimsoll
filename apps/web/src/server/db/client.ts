import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import pg from "pg";
import { env } from "../env";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const globalForDb = globalThis as unknown as { plimsollPool?: pg.Pool; plimsollDb?: Db; plimsollMigrated?: Promise<void> };

function pool(): pg.Pool {
  const ca = env().DATABASE_CA_CERT?.replaceAll("\\n", "\n");
  globalForDb.plimsollPool ??= new pg.Pool({ connectionString: env().DATABASE_URL, max: env().DB_POOL_MAX, ...(ca ? { ssl: { ca, rejectUnauthorized: true } } : {}) });
  return globalForDb.plimsollPool;
}

export function db(): Db {
  globalForDb.plimsollDb ??= drizzle(pool(), { schema });
  return globalForDb.plimsollDb;
}

/** Applies pending migrations once per process. */
export function ensureMigrated(): Promise<void> {
  globalForDb.plimsollMigrated ??= migrate(db(), { migrationsFolder: path.join(/*turbopackIgnore: true*/ process.cwd(), "drizzle"), migrationsSchema: "plimsoll_migrations" });
  return globalForDb.plimsollMigrated;
}

export { schema };
