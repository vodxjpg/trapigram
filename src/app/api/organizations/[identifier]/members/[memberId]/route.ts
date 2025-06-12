import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { getContext } from "@/lib/context";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function PATCH(
  req: NextRequest,
  { params }: { params: { identifier: string; memberId: string } }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  const { role } = await req.json();
  if (!role) return NextResponse.json({ error: "Missing role" }, { status: 400 });

  /* forbid changing current owner away from owner
     or creating second owner                                      */
  const current = await pool.query(
    `SELECT role FROM member WHERE id=$1 AND "organizationId"=$2`,
    [params.memberId, organizationId]
  );
  if (!current.rowCount) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  const wasOwner = current.rows[0].role.includes("owner");
  if (wasOwner && role !== "owner")
    return NextResponse.json({ error: "Cannot demote the owner" }, { status: 409 });

  if (role === "owner" && !wasOwner) {
    const otherOwner = await pool.query(
      `SELECT 1 FROM member
        WHERE "organizationId"=$1 AND position('owner' in role) > 0`,
      [organizationId]
    );
    if (otherOwner.rowCount)
      return NextResponse.json({ error: "Organization already has an owner" }, { status: 409 });
  }

  await pool.query(`UPDATE member SET role=$1 WHERE id=$2`, [role, params.memberId]);
  return NextResponse.json({ success: true });
}

/* ---------- DELETE member ---------- */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { identifier: string; memberId: string } }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  const { rows } = await pool.query(
    `DELETE FROM member
      WHERE id=$1 AND "organizationId"=$2
        AND position('owner' in role)=0        -- forbid deleting owner
      RETURNING id`,
    [params.memberId, organizationId]
  );
  if (!rows.length)
    return NextResponse.json({ error: "Cannot remove this member" }, { status: 409 });

  return NextResponse.json({ success: true });
}
