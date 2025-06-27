// src/app/api/organizations/[identifier]/roles/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";;
import { v4 as uuidv4 } from "uuid";
import { cleanPermissions } from "@/lib/utils/cleanPermissions";
import { getContext } from "@/lib/context";



/* ─────────────── Helpers ─────────────── */
async function assertOwner(orgId: string, userId: string) {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM member
     WHERE "organizationId" = $1 AND "userId" = $2 AND role = 'owner'`,
    [orgId, userId],
  );
  if (!rowCount) throw new Error("Only the organization owner may manage roles");
}

/* ─────────────── GET roles ─────────────── */
export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  const { rows } = await pool.query(
    `SELECT id, name, permissions, "createdAt"
       FROM "orgRole"
      WHERE "organizationId" = $1
      ORDER BY "createdAt" ASC`,
    [organizationId],
  );
  return NextResponse.json({ roles: rows });
}

/* ─────────────── POST create ─────────────── */
export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId, userId } = ctx;

  try { await assertOwner(organizationId, userId); }
  catch (e: any) { return NextResponse.json({ error: e.message }, { status: 403 }); }

  const { name, permissions } = await req.json();
  if (!name || !permissions)
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });

  const perms = cleanPermissions(permissions);   
  const id = uuidv4();
  const { rows } = await pool.query(
    `INSERT INTO "orgRole"(id,"organizationId",name,permissions,"createdAt")
     VALUES ($1,$2,$3,$4,now())
     RETURNING id,name,permissions,"createdAt"`,
     [id, organizationId, name.trim().toLowerCase(), JSON.stringify(perms)],
  );
  return NextResponse.json({ role: rows[0] }, { status: 201 });
}

/* ─────────────── PATCH update ─────────────── */
export async function PATCH(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId, userId } = ctx;

  try { await assertOwner(organizationId, userId); }
  catch (e: any) { return NextResponse.json({ error: e.message }, { status: 403 }); }

  const { roleId, name, permissions } = await req.json();
  if (!roleId) return NextResponse.json({ error: "roleId required" }, { status: 400 });

  const sets: string[] = [];
  const vals: any[] = [];
  let i = 1;
  if (name)        { sets.push(`name=$${++i}`);         vals.push(name.trim().toLowerCase()); }
  if (permissions) {
      sets.push(`permissions=$${++i}`);
      vals.push(JSON.stringify(cleanPermissions(permissions)));
    }

  vals.unshift(roleId); // at index 0 after shift
  const sql = `UPDATE "orgRole" SET ${sets.join(", ")} WHERE id=$1 RETURNING id,name,permissions`;
  const { rows } = await pool.query(sql, vals);
  if (!rows.length) return NextResponse.json({ error: "Role not found" }, { status: 404 });
  return NextResponse.json({ role: rows[0] });
}

/* ─────────────── DELETE ─────────────── */
export async function DELETE(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId, userId } = ctx;

  try { await assertOwner(organizationId, userId); }
  catch (e: any) { return NextResponse.json({ error: e.message }, { status: 403 }); }

  const { roleId } = await req.json();
  if (!roleId) return NextResponse.json({ error: "roleId required" }, { status: 400 });

  await pool.query(`DELETE FROM "orgRole" WHERE id=$1 AND "organizationId"=$2`, [roleId, organizationId]);
  return NextResponse.json({ success: true });
}
