/* eslint-disable @typescript-eslint/ban-types */
// Unified db.ts that works in both local and production
// Keeps your API: `import { Pool } from "pg"` and `export { pgPool }`
import { Pool } from "pg";
import { Kysely, PostgresDialect } from "kysely";

// ---- Optional: bring your generated DB interface here ----
// If you have a generated interface file (e.g., ./db-interfaces), import it.
// Otherwise, temporarily use `any` and swap later.
import type { DB } from "./db-interfaces";

const toBool = (v?: string) =>
  v === "1" || (v ? ["true", "yes", "on"].includes(v.toLowerCase()) : false);

function resolveConnectionString(): string {
  const url =
    process.env.DATABASE_URL ||
    process.env.PROD_DATABASE_URL ||
    process.env.LOCAL_DATABASE_URL ||
    process.env.SUPABASE_DB_URL;

  if (!url) {
    throw new Error(
      "No database URL found. Provide DATABASE_URL (or LOCAL_DATABASE_URL)."
    );
  }
  return url;
}

function shouldUseSSL(url: string): boolean {
  const prod = process.env.NODE_ENV === "production";
  return (
    toBool(process.env.DATABASE_SSL) ||
    /supabase\.co/.test(url) ||
    prod
  );
}

// Avoid creating multiple pools in dev with Next.js HMR
const globalAny = global as unknown as {
  __PG_POOL__?: Pool;
  __KYS_DB__?: Kysely<DB>;
};

function createPgPool(): Pool {
  const url = resolveConnectionString();

  const pool = new Pool({
    connectionString: url,
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT ?? 30000),
    ssl: shouldUseSSL(url) ? { rejectUnauthorized: false } : undefined,
  });

  if (process.env.NODE_ENV !== "production") {
    pool.on("connect", () => console.info("↯ DB connection established"));
    pool.on("error", (err) => console.error("DB client error:", err));
  }

  return pool;
}

export const pgPool: Pool =
  globalAny.__PG_POOL__ ?? (globalAny.__PG_POOL__ = createPgPool());

export const db: Kysely<DB> =
  globalAny.__KYS_DB__ ??
  (globalAny.__KYS_DB__ = new Kysely<DB>({
    dialect: new PostgresDialect({ pool: pgPool }),
  }));

export async function closeDb() {
  await pgPool.end();
}
