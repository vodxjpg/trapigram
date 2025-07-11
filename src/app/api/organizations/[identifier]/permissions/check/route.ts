import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { validatePermissions } from "@/lib/utils/validatePermissions";

type Permissions = Record<string, string[]>;

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId, userId } = ctx;

  /* ── 0. Parse & validate payload ───────────────────────────────────────── */
  let requiredPerms: Permissions;
  try {
    const body = (await req.json()) as { permissions: unknown };
    requiredPerms = validatePermissions(body.permissions);
    if (Object.keys(requiredPerms).length === 0) {
      throw new Error("Empty permissions object");
    }
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || "Invalid permissions payload" },
      { status: 400 },
    );
  }

  /* ── 1. Fetch member role (unchanged) ──────────────────────────────────── */
  const { rowCount: mRows, rows: m } = await pool.query<{ role: string }>(
    `SELECT role FROM member WHERE "userId" = $1 AND "organizationId" = $2`,
    [userId, organizationId],
  );
  if (mRows === 0) return NextResponse.json({ hasPermission: false });

  const memberRole = m[0].role.toLowerCase();
  if (memberRole === "owner" || memberRole === "admin") {
    return NextResponse.json({ hasPermission: true });
  }

  /* ── 2. Load custom role JSON ──────────────────────────────────────────── */
  const { rowCount: rRows, rows: r } = await pool.query<
    { permissions: Permissions | string }
  >(
    `SELECT permissions
       FROM "orgRole"
      WHERE lower(name) = $1 AND "organizationId" = $2`,
    [memberRole, organizationId],
  );
  if (rRows === 0) return NextResponse.json({ hasPermission: false });

  const assigned: Permissions =
    typeof r[0].permissions === "string"
      ? (JSON.parse(r[0].permissions) as Permissions)
      : (r[0].permissions as Permissions);

  /* ── 3. Compare ────────────────────────────────────────────────────────── */
  const ok = Object.entries(requiredPerms).every(([res, acts]) =>
    acts.every((a) => assigned[res]?.includes(a)),
  );
  return NextResponse.json({ hasPermission: ok });
}
