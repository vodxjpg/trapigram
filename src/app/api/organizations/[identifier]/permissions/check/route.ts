import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool }            from "@/lib/db";
import { getContext }                from "@/lib/context";

type Permissions = Record<string, string[]>;

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId, userId } = ctx;

  const { permissions: requiredPerms } = (await req.json()) as {
    permissions: Permissions;
  };
  if (!requiredPerms || Object.keys(requiredPerms).length === 0) {
    return NextResponse.json(
      { error: "Permissions to check are required" },
      { status: 400 },
    );
  }

  /* ── 1. Fetch member role ────────────────────────────────────────────── */
  const { rowCount: mRows, rows: m } = await pool.query<
    { role: string }
  >(
    `SELECT role
       FROM member
      WHERE "userId" = $1 AND "organizationId" = $2`,
    [userId, organizationId],
  );
  if (mRows === 0) return NextResponse.json({ hasPermission: false });

  const memberRole = m[0].role.toLowerCase();

  /* ── 2. Short-circuit for built-ins ───────────────────────────────────── */
  if (memberRole === "owner" || memberRole === "admin") {
    return NextResponse.json({ hasPermission: true });
  }

  /* ── 3. Load custom role JSON ─────────────────────────────────────────── */
  const { rowCount: rRows, rows: r } = await pool.query<
    { permissions: Permissions | string }
  >(
    `SELECT permissions
       FROM "orgRole"
      WHERE lower(name) = $1 AND "organizationId" = $2`,
    [memberRole, organizationId],
  );
  if (rRows === 0) return NextResponse.json({ hasPermission: false });

  // permissions may arrive as text → normalise to object
  const assigned: Permissions =
    typeof r[0].permissions === "string"
      ? (JSON.parse(r[0].permissions) as Permissions)
      : (r[0].permissions as Permissions);

  /* ── 4. Compare requested vs granted ──────────────────────────────────── */
  const ok = Object.entries(requiredPerms).every(([resource, acts]) =>
    acts.every((a) => assigned[resource]?.includes(a)),
  );

  return NextResponse.json({ hasPermission: ok });
}
