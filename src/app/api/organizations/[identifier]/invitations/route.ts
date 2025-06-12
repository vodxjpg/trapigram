// src/app/api/organizations/[identifier]/invitations/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { getContext } from "@/lib/context";
import { requirePermission } from "@/lib/perm-server";
import { v4 as uuidv4 } from "uuid";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
// GET pending invitations
export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  const { rows: invitations } = await pool.query(
    `SELECT id, email, role, status, "expiresAt"
       FROM invitation
      WHERE "organizationId" = $1 AND status = 'pending'
      ORDER BY "expiresAt" ASC`,
    [organizationId]
  );
  return NextResponse.json({ invitations });
}

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
    // enforce member:invite
  const guard = await requirePermission(req, { invitation: ["create"] });
  if (guard) return guard;
  const { organizationId, userId: inviterId } = ctx;

  const { email, role } = await req.json();
  if (!email || !role) {
    return NextResponse.json({ error: "Missing email or role" }, { status: 400 });
  }

  /* ----------------------------------------------------------------
     0) Guard: only the current owner may attempt an owner-invite
  ----------------------------------------------------------------- */
  const { rows: inviterRows } = await pool.query(
    `SELECT role
       FROM member
      WHERE "organizationId" = $1
        AND "userId"        = $2
      LIMIT 1`,
    [organizationId, inviterId],
  );
  const inviterRole = inviterRows[0]?.role ?? null;

  if (role === inviterRole) {
    return NextResponse.json(
      { error: "You cannot invite someone to your own role" },
      { status: 403 }
    );
  }

  // 0b) Only an owner may invite another owner
  if (role === "owner" && inviterRole !== "owner") {
    return NextResponse.json(
      { error: "Only the existing organization owner may invite another owner" },
      { status: 403 }
    );
  }

  /* 1) Already a member? */
  const m = await pool.query(
    `SELECT 1
       FROM member
      WHERE "organizationId" = $1
        AND "userId" = (SELECT id FROM "user" WHERE email = $2)`,
    [organizationId, email],
  );
  if (m.rowCount) {
    return NextResponse.json({ error: "User is already a member" }, { status: 409 });
  }

  /* 2) Unique-owner guard (member + pending) */
  if (role === "owner") {
    const ownerExists = await pool.query(
      `SELECT 1
         FROM member
        WHERE "organizationId" = $1
          AND role = 'owner'
        LIMIT 1`,
      [organizationId],
    );
    if (ownerExists.rowCount) {
      return NextResponse.json(
        { error: "Organization already has an owner" },
        { status: 409 },
      );
    }

    const pendingOwner = await pool.query(
      `SELECT 1
         FROM invitation
        WHERE "organizationId" = $1
          AND role             = 'owner'
          AND status           = 'pending'
        LIMIT 1`,
      [organizationId],
    );
    if (pendingOwner.rowCount) {
      return NextResponse.json(
        { error: "Owner invitation already pending" },
        { status: 409 },
      );
    }
  }

  /* 3) Already invited (same e-mail) */
  const i = await pool.query(
    `SELECT 1
       FROM invitation
      WHERE "organizationId" = $1
        AND email            = $2
        AND status           = 'pending'
      LIMIT 1`,
    [organizationId, email],
  );
  if (i.rowCount) {
    return NextResponse.json({ error: "Invitation already pending" }, { status: 409 });
  }

  /* 4) Insert new invitation */
  const id        = uuidv4();
  const now       = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 3600_000).toISOString();

  const { rows } = await pool.query(
    `INSERT INTO invitation
          (id,  "inviterId", "organizationId", email, role, status, "expiresAt", "createdAt")
     VALUES ($1, $2,         $3,              $4,    $5,   'pending', $6,          $7)
     RETURNING id, email, role, status, "expiresAt"`,
    [id, inviterId, organizationId, email, role, expiresAt, now.toISOString()],
  );

  return NextResponse.json({ invitation: rows[0] }, { status: 201 });
}
