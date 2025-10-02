// src/lib/credits/db.ts
import { pgPool as pool } from "@/lib/db";

/** Ensure a wallet exists for (organizationId, userId, 'GEMS'); return row. */
export async function ensureWallet(organizationId: string, userId: string) {
  const sel = await pool.query(
    `SELECT "id","currency","status","createdAt","updatedAt"
     FROM "creditWallets"
     WHERE "organizationId"=$1 AND "userId"=$2 AND "currency"='GEMS'`,
    [organizationId, userId],
  );
  if (sel.rowCount === 1) return sel.rows[0];

  const id = crypto.randomUUID();
  const ins = await pool.query(
    `INSERT INTO "creditWallets"
      ("id","organizationId","userId","currency","status","createdAt","updatedAt")
     VALUES ($1,$2,$3,'GEMS','active',NOW(),NOW())
     RETURNING "id","currency","status","createdAt","updatedAt"`,
    [id, organizationId, userId],
  );
  return ins.rows[0];
}

export async function getBalances(orgId: string, walletId: string) {
  const [{ rows: credits }, { rows: debits }, { rows: holds }] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM("amountMinor"),0) AS s
       FROM "creditLedgerEntries"
       WHERE "organizationId"=$1 AND "walletId"=$2 AND "direction"='credit'`,
      [orgId, walletId],
    ),
    pool.query(
      `SELECT COALESCE(SUM("amountMinor"),0) AS s
       FROM "creditLedgerEntries"
       WHERE "organizationId"=$1 AND "walletId"=$2 AND "direction"='debit'`,
      [orgId, walletId],
    ),
    pool.query(
      `SELECT COALESCE(SUM("amountMinor"),0) AS s
       FROM "creditHolds"
       WHERE "organizationId"=$1 AND "walletId"=$2 AND "status"='active'`,
      [orgId, walletId],
    ),
  ]);
  const c = Number(credits[0].s || 0);
  const d = Number(debits[0].s || 0);
  const h = Number(holds[0].s || 0);
  const available = c - d - h;
  const onHold = h;
  const balance = available + onHold;
  return { available, onHold, balance };
}

export async function insertLedgerEntry(args: {
  organizationId: string;
  walletId: string;
  direction: "credit" | "debit";
  amountMinor: number;
  reason: "purchase" | "capture" | "manual_adjustment" | "refund";
  reference: any;
  idempotencyKey: string;
}) {
  const id = crypto.randomUUID();
  const { organizationId, walletId, direction, amountMinor, reason, reference, idempotencyKey } =
    args;
  const res = await pool.query(
    `INSERT INTO "creditLedgerEntries"
      ("id","organizationId","walletId","direction","amountMinor","reason","reference","idempotencyKey","createdAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
     ON CONFLICT ("walletId","idempotencyKey") DO NOTHING
     RETURNING "id"`,
    [id, organizationId, walletId, direction, amountMinor, reason, reference, idempotencyKey],
  );
  if (res.rowCount === 1) return { id: res.rows[0].id as string };
  const existing = await pool.query(
    `SELECT "id" FROM "creditLedgerEntries" WHERE "walletId"=$1 AND "idempotencyKey"=$2`,
    [walletId, idempotencyKey],
  );
  return { id: existing.rows[0].id as string };
}

export async function findUserIdByExternalIdentity(
  organizationId: string,
  provider: string,
  providerUserId: string,
): Promise<string | null> {
  const r = await pool.query(
    `SELECT "userId"
     FROM "creditExternalIdentities"
     WHERE "organizationId"=$1 AND "provider"=$2 AND "providerUserId"=$3
     LIMIT 1`,
    [organizationId, provider, providerUserId],
  );
  if (r.rowCount === 0) return null;
  return r.rows[0].userId as string;
}

export async function upsertExternalIdentity(args: {
  organizationId: string;
  userId: string;
  provider: string;
  providerUserId: string;
  email?: string | null;
}) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO "creditExternalIdentities"
      ("id","organizationId","userId","provider","providerUserId","email","createdAt")
     VALUES ($1,$2,$3,$4,$5,$6,NOW())
     ON CONFLICT ("organizationId","provider","providerUserId")
     DO UPDATE SET "userId"=EXCLUDED."userId","email"=COALESCE(EXCLUDED."email","creditExternalIdentities"."email")`,
    [id, args.organizationId, args.userId, args.provider, args.providerUserId, args.email ?? null],
  );
}

export async function createHold(args: {
  organizationId: string;
  walletId: string;
  provider: string;
  orderId: string;
  amountMinor: number;
  ttlSec: number;
}) {
  const holdId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + args.ttlSec * 1000);
  await pool.query(
    `INSERT INTO "creditHolds"
      ("id","organizationId","walletId","provider","orderId","amountMinor","status","expiresAt","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,'active',$7,NOW(),NOW())`,
    [holdId, args.organizationId, args.walletId, args.provider, args.orderId, args.amountMinor, expiresAt],
  );
  return { holdId, expiresAt };
}

export async function captureHold(args: {
  organizationId: string;
  holdId: string;
  idempotencyKey: string;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const h = await client.query(
      `SELECT "id","walletId","orderId","provider","amountMinor","status"
       FROM "creditHolds"
       WHERE "organizationId"=$1 AND "id"=$2
       FOR UPDATE`,
      [args.organizationId, args.holdId],
    );
    if (h.rowCount === 0) {
      await client.query("ROLLBACK");
      return { error: "Hold not found", status: 404 } as const;
    }
    const hold = h.rows[0];
    if (hold.status !== "active") {
      await client.query("ROLLBACK");
      return { error: "Hold is not active", status: 409 } as const;
    }

    // Insert debit (capture) idempotently
    const ledgerId = crypto.randomUUID();
    await client.query(
      `INSERT INTO "creditLedgerEntries"
        ("id","organizationId","walletId","direction","amountMinor","reason","reference","idempotencyKey","createdAt")
       VALUES ($1,$2,$3,'debit',$4,'capture',$5,$6,NOW())
       ON CONFLICT ("walletId","idempotencyKey") DO NOTHING`,
      [
        ledgerId,
        args.organizationId,
        hold.walletId,
        hold.amountMinor,
        JSON.stringify({ provider: hold.provider, orderId: hold.orderId }),
        args.idempotencyKey,
      ],
    );

    // Mark hold as captured
    await client.query(
      `UPDATE "creditHolds" SET "status"='captured',"updatedAt"=NOW()
       WHERE "organizationId"=$1 AND "id"=$2`,
      [args.organizationId, args.holdId],
    );

    await client.query("COMMIT");

    // Recompute balances
    const bal = await getBalances(args.organizationId, hold.walletId);
    return { ok: true, walletId: hold.walletId, balances: bal } as const;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function releaseHold(args: { organizationId: string; holdId: string }) {
  const res = await pool.query(
    `UPDATE "creditHolds"
     SET "status"='released',"updatedAt"=NOW()
     WHERE "organizationId"=$1 AND "id"=$2 AND "status"='active'
     RETURNING "walletId"`,
    [args.organizationId, args.holdId],
  );
  if (res.rowCount === 0) return { changed: false } as const;
  const walletId = res.rows[0].walletId as string;
  const balances = await getBalances(args.organizationId, walletId);
  return { changed: true, walletId, balances } as const;
}

export async function findActiveHoldByOrder(args: {
  organizationId: string;
  walletId: string;
  orderId: string;
}) {
  const r = await pool.query(
    `SELECT "id","amountMinor","status" FROM "creditHolds"
     WHERE "organizationId"=$1 AND "walletId"=$2 AND "orderId"=$3 AND "status"='active'
     LIMIT 1`,
    [args.organizationId, args.walletId, args.orderId],
  );
  if (r.rowCount === 0) return null;
  return r.rows[0] as { id: string; amountMinor: string; status: string };
}
