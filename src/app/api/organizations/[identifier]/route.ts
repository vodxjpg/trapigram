// src/app/api/organizations/[identifier]/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import crypto from "crypto";

const ENC_KEY_B64 = process.env.ENCRYPTION_KEY!;
const ENC_IV_B64 = process.env.ENCRYPTION_IV!;

function getEncryptionKeyAndIv(): { key: Buffer; iv: Buffer } {
  const key = Buffer.from(ENC_KEY_B64, "base64");
  const iv = Buffer.from(ENC_IV_B64, "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes");
  if (iv.length !== 16) throw new Error("ENCRYPTION_IV must be 16 bytes");
  return { key, iv };
}

/* ─── GET single ──────────────────────────────────────────────── */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ identifier: string }> }
) {
  const { identifier } = await params;

  if (!identifier) {
    return NextResponse.json({ error: "identifier is required" }, { status: 400 });
  }

  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { userId } = ctx;
  const isService = userId === "service-account";

  const baseSql = `
    SELECT
      o.id, o.name, o.slug, o.logo,
      o.countries, o.metadata, o."encryptedSecret",
      COUNT(m2."userId") AS "memberCount",
      MAX(m.role) FILTER (WHERE m."userId" = $2) AS "userRole"
    FROM organization o
    LEFT JOIN member m  ON m."organizationId" = o.id
    LEFT JOIN member m2 ON m2."organizationId" = o.id
    WHERE (o.id = $1 OR o.slug = $1)
    /**MEMBERSHIP**/
    GROUP BY o.id, o.name, o.slug, o.logo,
             o.countries, o.metadata, o."encryptedSecret"
  `;

  const sqlText = isService
    ? baseSql.replace("/**MEMBERSHIP**/", "")
    : baseSql.replace(
      "/**MEMBERSHIP**/",
      `AND EXISTS (
           SELECT 1 FROM member
            WHERE "organizationId" = o.id
              AND "userId"       = $2
         )`
    );

  try {
    const { rows } = await pool.query(sqlText, [identifier, userId]);
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Organization not found or access denied" },
        { status: 404 }
      );
    }
    const r = rows[0];
    return NextResponse.json({
      organization: {
        id: r.id,
        name: r.name,
        slug: r.slug,
        logo: r.logo,
        countries: r.countries,
        metadata: r.metadata,
        encryptedSecret: r.encryptedSecret,
        memberCount: Number(r.memberCount),
        userRole: isService ? null : r.userRole,
      },
    });
  } catch (err) {
    console.error("[GET /api/organizations/:identifier] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/* ─── DELETE ──────────────────────────────────────────────────── */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ identifier: string }> }
) {
  const { identifier } = await params;

  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  if (ctx.organizationId !== identifier) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await pool.query("BEGIN");
    await pool.query(`DELETE FROM member WHERE "organizationId" = $1`, [identifier]);
    await pool.query(
      `DELETE FROM organizationPlatformKey WHERE "organizationId" = $1`,
      [identifier]
    );
    await pool.query(`DELETE FROM organization WHERE id = $1`, [identifier]);
    await pool.query("COMMIT");
    return NextResponse.json({ id: identifier });
  } catch (err) {
    await pool.query("ROLLBACK");
    console.error("[DELETE /api/organizations/:identifier] error:", err);
    return NextResponse.json({ error: "Failed to delete org" }, { status: 500 });
  }
}

/* ─── PATCH ───────────────────────────────────────────────────── */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ identifier: string }> }
) {
  const { identifier } = await params;

  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  if (ctx.organizationId !== identifier) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, slug, countries, secretPhrase } = body;
  if (!name && !slug && !countries && !secretPhrase) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const sets: string[] = [];
  const vals: any[] = [];
  let idx = 1;

  if (name) {
    sets.push(`name = $${idx++}`);
    vals.push(name);
  }
  if (slug) {
    sets.push(`slug = $${idx++}`);
    vals.push(slug);
  }
  if (countries) {
    sets.push(`countries = $${idx++}`);
    vals.push(JSON.stringify(countries));
  }
  if (secretPhrase) {
    const { key, iv } = getEncryptionKeyAndIv();
    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
    const encrypted =
      cipher.update(secretPhrase, "utf8", "base64") + cipher.final("base64");
    sets.push(`"encryptedSecret" = $${idx++}`);
    vals.push(encrypted);
  }

  vals.push(identifier);
  const sqlText = `
    UPDATE organization
       SET ${sets.join(", ")}
     WHERE id = $${idx}
  `;

  try {
    const res = await pool.query(sqlText, vals);
    if (res.rowCount === 0) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[PATCH /api/organizations/:identifier] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
