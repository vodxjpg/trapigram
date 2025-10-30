// src/lib/db.ts
import { Pool } from "pg";
import { Kysely, PostgresDialect, type Selectable, type Insertable, type Updateable } from "kysely";
import type { DB } from "./db-interfaces"; // <- update path if needed

/* ------------------------------ Config helpers ----------------------------- */
const isProd = process.env.NODE_ENV === "production";

function toBool(v?: string) {
  if (!v) return false;
  const s = v.toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function resolveConnectionString(): string {
  const url =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.SUPABASE_DB_URL;

  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  return url;
}

/** In prod (Supabase / managed PG) we usually want TLS.
 *  If you have a self-signed chain, using `rejectUnauthorized:false` avoids
 *  `SELF_SIGNED_CERT_IN_CHAIN`. If you provide a CA, set it here instead. */
function buildSslConfig() {
  const url = resolveConnectionString();
  const looksLikeSupabase = /supabase\.co/.test(url);
  const wantSSL = toBool(process.env.DATABASE_SSL) || looksLikeSupabase || isProd;

  if (!wantSSL) return undefined;

  // Option A (relaxed): avoids SELF_SIGNED_CERT_IN_CHAIN immediately
  return { rejectUnauthorized: false } as const;

  // Option B (strict): if you have CA in env/file, do:
  // const ca = process.env.POSTGRES_SSL_CA?.replace(/\\n/g, "\n");
  // return ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false };
}

/* -------------------------- Singletons (Next.js dev) ------------------------- */
const globalForDb = globalThis as unknown as {
  __PG_POOL__?: Pool;
  __KYSELY__?: Kysely<DB>;
};

if (!globalForDb.__PG_POOL__) {
  const url = resolveConnectionString();
  globalForDb.__PG_POOL__ = new Pool({
    connectionString: url,
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT ?? 30_000),
    ssl: buildSslConfig(),
  });

  if (!isProd) {
    globalForDb.__PG_POOL__.on("connect", () => console.info("↯ DB connection established"));
    globalForDb.__PG_POOL__.on("error", (err) => console.error("DB client error:", err));
  }
}

export const pgPool = globalForDb.__PG_POOL__!;

if (!globalForDb.__KYSELY__) {
  globalForDb.__KYSELY__ = new Kysely<DB>({
    dialect: new PostgresDialect({ pool: pgPool }),
  });
}

export const db = globalForDb.__KYSELY__;

/* ------------------------------ Helpful re-exports ------------------------------ */
// Consumers can import these to type rows cleanly:
//   type User = Selectable<DB["public.user"]>
//   type NewUser = Insertable<DB["public.user"]>
//   type UserUpdate = Updateable<DB["public.user"]>
export type { Selectable, Insertable, Updateable };
