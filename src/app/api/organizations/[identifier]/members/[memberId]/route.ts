// src/app/api/organizations/[identifier]/members/[memberId]/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { requireOrgPermission } from "@/lib/perm-server";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ identifier: string; memberId: string }> }
) {
  const { identifier, memberId } = await params;

  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId, userId: callerId } = ctx;

  if (identifier !== organizationId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { role: newRole } = await req.json();
  if (!newRole) return NextResponse.json({ error: "Missing role" }, { status: 400 });

  const currentQ = await pool.query<{ role: string }>(
    `SELECT role FROM member WHERE id = $1 AND "organizationId" = $2`,
    [memberId, organizationId]
  );
  if (!currentQ.rowCount) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }
  const oldRole = currentQ.rows[0].role;

  const callerQ = await pool.query<{ role: string }>(
    `SELECT role FROM member WHERE "organizationId" = $1 AND "userId" = $2`,
    [organizationId, callerId]
  );
  const callerRole = callerQ.rows[0]?.role;

  if (oldRole === "owner" && newRole !== "owner") {
    return NextResponse.json({ error: "Cannot demote the owner" }, { status: 403 });
  }
  if (newRole === "owner" && callerRole !== "owner") {
    return NextResponse.json({ error: "Only owners may promote to owner" }, { status: 403 });
  }

  if (callerRole !== "owner") {
    if (oldRole === callerRole) {
      return NextResponse.json(
        { error: "You can only change roles of users in a different role" },
        { status: 403 }
      );
    }
    if (newRole === callerRole) {
      return NextResponse.json(
        { error: "You cannot assign someone to your own role" },
        { status: 403 }
      );
    }
  }

  if (newRole === "owner" && oldRole !== "owner") {
    const ownerQ = await pool.query(
      `SELECT 1 FROM member WHERE "organizationId" = $1 AND position('owner' in role) > 0`,
      [organizationId]
    );
    if (ownerQ.rowCount) {
      return NextResponse.json(
        { error: "Organization already has an owner" },
        { status: 409 }
      );
    }
  }

  await pool.query(
    `UPDATE member
       SET role = $1
     WHERE id = $2
       AND "organizationId" = $3`,
    [newRole, memberId, organizationId]
  );

  return NextResponse.json({ success: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ identifier: string; memberId: string }> }
) {
  const { identifier, memberId } = await params;

  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId, userId: callerId } = ctx;

  if (identifier !== organizationId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const callerRes = await pool.query<{ role: string }>(
    `SELECT role FROM member WHERE "organizationId" = $1 AND "userId" = $2`,
    [organizationId, callerId]
  );
  const callerRole = callerRes.rows[0]?.role;

  if (callerRole !== "owner") {
    const guard = await requireOrgPermission(req, { member: ["delete"] });
    if (guard) return guard;
  }

  const targetRes = await pool.query<{ role: string }>(
    `SELECT role FROM member WHERE id = $1 AND "organizationId" = $2`,
    [memberId, organizationId]
  );
  if (!targetRes.rowCount) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }
  const targetRole = targetRes.rows[0].role;

  if (targetRole === "owner") {
    return NextResponse.json({ error: "Cannot remove the owner" }, { status: 409 });
  }

  await pool.query(
    `DELETE FROM member WHERE id = $1 AND "organizationId" = $2`,
    [memberId, organizationId]
  );

  return NextResponse.json({ success: true });
}
