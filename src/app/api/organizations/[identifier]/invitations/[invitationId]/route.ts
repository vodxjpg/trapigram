// src/app/api/organizations/[identifier]/invitations/[invitationId]/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ identifier: string; invitationId: string }> } // Next 16: params is a Promise
) {
  const { identifier, invitationId } = await context.params;

  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  // Ensure the route org matches the caller's org
  if (identifier !== organizationId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
