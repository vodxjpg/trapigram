import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { getContext } from "@/lib/context";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function DELETE(
  req: NextRequest,
  { params }: { params: { invitationId: string } }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;
  const { invitationId } = params;

  const res = await pool.query(
    `DELETE FROM invitation
      WHERE id = $1 AND "organizationId" = $2`,
    [invitationId, organizationId]
  );
  if (res.rowCount === 0) {
    return NextResponse.json(
      { error: "Invitation not found or not allowed" },
      { status: 404 }
    );
  }
  return NextResponse.json({ success: true });
}
