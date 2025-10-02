// src/lib/credits/sync.ts
import { pgPool as pool } from "@/lib/db";

/** Generate short code like XXXX-XXXX-XXXX (A-Z0-9). */
function genCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const pick = () => chars[Math.floor(Math.random() * chars.length)];
  const block = () => Array.from({ length: 4 }, pick).join("");
  return `${block()}-${block()}-${block()}`;
}

export async function createSyncCode(args: {
  organizationId: string;
  provider: string;
  providerUserId: string;
  email?: string | null;
  ttlSec?: number;
}) {
  const ttl = Math.max(60, Math.min(args.ttlSec ?? 900, 3600));
  const expiresAt = new Date(Date.now() + ttl * 1000);

  let code = genCode();
  // Very low collision chance; still loop for safety
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await pool.query(
        `INSERT INTO "creditSyncCodes"
          ("code","organizationId","provider","providerUserId","email","status","userId","expiresAt","createdAt","updatedAt")
         VALUES ($1,$2,$3,$4,$5,'active',NULL,$6,NOW(),NOW())`,
        [code, args.organizationId, args.provider, args.providerUserId, args.email ?? null, expiresAt],
      );
      break;
    } catch {
      code = genCode();
    }
  }
  return { code, expiresAt };
}

export async function redeemSyncCode(args: {
  organizationId: string;
  code: string;
  userId: string;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `SELECT "code","provider","providerUserId","email","status","expiresAt"
       FROM "creditSyncCodes"
       WHERE "organizationId"=$1 AND "code"=$2
       FOR UPDATE`,
      [args.organizationId, args.code],
    );
    if (r.rowCount === 0) {
      await client.query("ROLLBACK");
      return { error: "Code not found", status: 404 } as const;
    }
    const row = r.rows[0];
    if (row.status !== "active") {
      await client.query("ROLLBACK");
      return { error: "Code already used/expired", status: 409 } as const;
    }
    if (new Date(row.expiresAt).getTime() < Date.now()) {
      await client.query("ROLLBACK");
      return { error: "Code expired", status: 410 } as const;
    }

    await client.query(
      `UPDATE "creditSyncCodes"
       SET "status"='used',"userId"=$3,"updatedAt"=NOW()
       WHERE "organizationId"=$1 AND "code"=$2`,
      [args.organizationId, args.code, args.userId],
    );

    await client.query(
      `INSERT INTO "creditExternalIdentities"
        ("id","organizationId","userId","provider","providerUserId","email","createdAt")
       VALUES ($1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT ("organizationId","provider","providerUserId")
       DO UPDATE SET "userId"=EXCLUDED."userId","email"=COALESCE(EXCLUDED."email","creditExternalIdentities"."email")`,
      [
        crypto.randomUUID(),
        args.organizationId,
        args.userId,
        row.provider as string,
        row.providerUserId as string,
        row.email ?? null,
      ],
    );

    await client.query("COMMIT");
    return { ok: true } as const;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
