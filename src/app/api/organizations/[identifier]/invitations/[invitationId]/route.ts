import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";;
import { getContext } from "@/lib/context";
import { requireOrgPermission } from "@/lib/perm-server";



export async function DELETE(
  req: NextRequest,
  { params }: { params: { invitationId: string } }
) {
  const guard = await requireOrgPermission(req, { invitation: ["cancel"] });
  if (guard) return guard;
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
