// src/app/api/organizations/[identifier]/members/[memberId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { getContext } from "@/lib/context";
import { requirePermission } from "@/lib/perm-server";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function PATCH(req: NextRequest, { params }: { params: { identifier: string; memberId: string } }) {

  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId, userId: callerId } = ctx;
  const { memberId } = params;
  const { role: newRole } = await req.json();
  if (!newRole) return NextResponse.json({ error: "Missing role" }, { status: 400 });

  // 1) Fetch the target member's current role
  const currentQ = await pool.query< { role: string } >(
    `SELECT role FROM member WHERE id = $1 AND "organizationId" = $2`,
    [memberId, organizationId]
  );
  if (!currentQ.rowCount) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }
  const oldRole = currentQ.rows[0].role;

  // 2) Fetch the caller's role
  const callerQ = await pool.query< { role: string } >(
    `SELECT role FROM member WHERE "organizationId" = $1 AND "userId" = $2`,
    [organizationId, callerId]
  );
  const callerRole = callerQ.rows[0]?.role;

  // 3) Only owners may promote/demote owner
  if (oldRole === "owner" && newRole !== "owner") {
    return NextResponse.json(
      { error: "Cannot demote the owner" },
      { status: 403 }
    );
  }
  if (newRole === "owner" && callerRole !== "owner") {
    return NextResponse.json(
      { error: "Only owners may promote to owner" },
      { status: 403 }
    );
  }

  // 4) Prevent same-role operations for non-owners
  if (callerRole !== "owner") {
    // you cannot change peers (oldRole === callerRole)
    if (oldRole === callerRole) {
      return NextResponse.json(
        { error: "You can only change roles of users in a different role" },
        { status: 403 }
      );
    }
    // you cannot assign someone to your own role
    if (newRole === callerRole) {
      return NextResponse.json(
        { error: "You cannot assign someone to your own role" },
        { status: 403 }
      );
    }
  }

  // 5) Ensure there is only one owner in the org
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

  // 6) Perform the update
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
  { params }: { params: { identifier: string; memberId: string } }
) {
  // 1) fetch context
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId, userId: callerId } = ctx;

  // 2) fetch caller role
  const callerRes = await pool.query<{ role: string }>(
    `SELECT role FROM member WHERE "organizationId" = $1 AND "userId" = $2`,
    [organizationId, callerId]
  );
  const callerRole = callerRes.rows[0]?.role;

  // 3) non-owners must have member:delete
  if (callerRole !== "owner") {
    const guard = await requirePermission(req, { member: ["delete"] });
    if (guard) return guard;
  }

  // 4) load the target member’s role
  const targetRes = await pool.query<{ role: string }>(
    `SELECT role FROM member WHERE id = $1 AND "organizationId" = $2`,
    [params.memberId, organizationId]
  );
  if (!targetRes.rowCount) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }
  const targetRole = targetRes.rows[0].role;

  // 5) forbid deleting the owner
  if (targetRole === "owner") {
    return NextResponse.json(
      { error: "Cannot remove the owner" },
      { status: 409 }
    );
  }

  // 6) delete
  await pool.query(
    `DELETE FROM member WHERE id = $1 AND "organizationId" = $2`,
    [params.memberId, organizationId]
  );

  return NextResponse.json({ success: true });
}