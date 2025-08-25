// src/app/api/organizations/[identifier]/roles/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import { cleanPermissions } from "@/lib/utils/cleanPermissions";
import { getContext } from "@/lib/context";
import { primeOrgRoles } from "@/lib/auth/roles-cache";
import { validatePermissions } from "@/lib/utils/validatePermissions";

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
  await primeOrgRoles(organizationId);
  return NextResponse.json({ roles: rows });
}

const RESERVED = new Set(["owner", "admin"]);

/* ─────────────── POST create ─────────────── */
export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId, userId } = ctx;

  try {
    await assertOwner(organizationId, userId);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 403 });
  }

  const body = await req.json();
  const { name, permissions } = body || {};

  /* ── validation ───────────────────────────────────────────────── */
  if (!name || !permissions) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  const roleName = String(name).trim().toLowerCase();
  if (RESERVED.has(roleName)) {
    return NextResponse.json({ error: "Reserved role name" }, { status: 400 });
  }

  /* ensure name uniqueness inside org */
  const dupe = await pool.query(
    `SELECT 1 FROM "orgRole" WHERE lower(name) = $1 AND "organizationId" = $2`,
    [roleName, organizationId],
  );
  if (dupe.rowCount) {
    return NextResponse.json({ error: "Role name already exists" }, { status: 409 });
  }

  /* normalise & validate permissions */
  let perms: unknown;
  try {
    perms = cleanPermissions(validatePermissions(permissions));
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Invalid permissions" },
      { status: 400 },
    );
  }

  /* insert and return */
  const id = uuidv4();
  const insertSql = `
    INSERT INTO "orgRole" ("id","organizationId","name","permissions","createdAt","updatedAt")
    VALUES ($1,$2,$3,$4,NOW(),NOW())
    RETURNING id, name, permissions, "createdAt"
  `;
  const insertVals = [id, organizationId, roleName, JSON.stringify(perms)];
  const { rows } = await pool.query(insertSql, insertVals);
  await primeOrgRoles(organizationId);
  return NextResponse.json({ role: rows[0] }, { status: 200 });
}

/* ─────────────── PATCH update ─────────────── */
export async function PATCH(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId, userId } = ctx;

  try {
    await assertOwner(organizationId, userId);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 403 });
  }

  const body = await req.json();
  const { roleId, name, permissions } = body || {};
  if (!roleId) {
    return NextResponse.json({ error: "roleId required" }, { status: 400 });
  }

  const sets: string[] = [];
  const vals: any[] = [];
  let i = 1;

  if (name) {
    const roleName = String(name).trim().toLowerCase();
    if (RESERVED.has(roleName)) {
      return NextResponse.json({ error: "Reserved role name" }, { status: 400 });
    }
    const clash = await pool.query(
      `SELECT 1 FROM "orgRole"
        WHERE lower(name) = $1 AND "organizationId" = $2 AND id <> $3`,
      [roleName, organizationId, roleId],
    );
    if (clash.rowCount) {
      return NextResponse.json({ error: "Role name already exists" }, { status: 409 });
    }
    sets.push(`name=$${++i}`);
    vals.push(roleName);
  }

  if (permissions) {
    let normalized: unknown;
    try {
      normalized = cleanPermissions(validatePermissions(permissions));
    } catch (err: any) {
      return NextResponse.json(
        { error: err?.message || "Invalid permissions" },
        { status: 400 },
      );
    }
    sets.push(`permissions=$${++i}`);
    vals.push(JSON.stringify(normalized));
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  vals.unshift(roleId);
  const sql = `UPDATE "orgRole" SET ${sets.join(", ")}, "updatedAt"=NOW() WHERE id=$1 RETURNING id,name,permissions`;
  const { rows } = await pool.query(sql, vals);
  if (!rows.length) {
    return NextResponse.json({ error: "Role not found" }, { status: 404 });
  }
  await primeOrgRoles(organizationId);
  return NextResponse.json({ role: rows[0] });
}

/* ─────────────── DELETE ─────────────── */
export async function DELETE(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId, userId } = ctx;

  try {
    await assertOwner(organizationId, userId);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 403 });
  }

  const body = await req.json();
  const { roleId } = body || {};
  if (!roleId) return NextResponse.json({ error: "roleId required" }, { status: 400 });

  await pool.query(
    `DELETE FROM "orgRole" WHERE id=$1 AND "organizationId"=$2`,
    [roleId, organizationId],
  );
  await primeOrgRoles(organizationId);
  return NextResponse.json({ success: true });
}
