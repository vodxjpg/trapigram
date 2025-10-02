// src/app/api/credits/me/ledger/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { pgPool as pool } from "@/lib/db";
import { ensureWallet } from "@/lib/credits/db";

export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId, userId } = ctx as any;
  if (!organizationId || !userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = new URL(req.url).searchParams;
  const page = Number(params.get("page") || "1");
  const pageSize = Math.min(100, Math.max(1, Number(params.get("pageSize") || "20")));

  const wallet = await ensureWallet(organizationId, userId);

  const countRes = await pool.query(
    `SELECT COUNT(*) FROM "creditLedgerEntries" WHERE "organizationId"=$1 AND "walletId"=$2`,
    [organizationId, wallet.id],
  );
  const totalRows = Number(countRes.rows[0].count);
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const offset = (page - 1) * pageSize;

  const rowsRes = await pool.query(
    `SELECT "id","direction","amountMinor","reason","reference","createdAt"
     FROM "creditLedgerEntries"
     WHERE "organizationId"=$1 AND "walletId"=$2
     ORDER BY "createdAt" DESC, "id" DESC
     LIMIT $3 OFFSET $4`,
    [organizationId, wallet.id, pageSize, offset],
  );

  return NextResponse.json({
    items: rowsRes.rows,
    currentPage: page,
    totalPages,
  });
}
