import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";

function sanitizeHtml(s: string | null | undefined) {
  if (!s) return "";
  return s
    .replace(/<\/p>/gi, "\n")
    .replace(/<p>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .trim();
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function joinUrl(base: string, path: string) {
  if (!base) return path;
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

export async function POST(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get("organizationId");
  if (!orgId) {
    return NextResponse.json({ error: "organizationId required" }, { status: 400 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { userId, username, firstName, lastName } = body ?? {};
  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  try {
    // Upsert (update-then-insert) and ALWAYS return one row
    const upsertSql = `
      WITH upd AS (
        UPDATE clients
           SET "username"  = COALESCE($3, clients."username"),
               "firstName" = COALESCE($4, clients."firstName"),
               "lastName"  = COALESCE($5, clients."lastName"),
               "updatedAt" = NOW()
         WHERE "organizationId" = $1 AND "userId" = $2
         RETURNING id, "userId", "username", "firstName", "lastName", "levelId"
      ),
      ins AS (
        INSERT INTO clients ("organizationId","userId","username","firstName","lastName","createdAt","updatedAt")
        SELECT $1,$2,$3,$4,$5,NOW(),NOW()
        WHERE NOT EXISTS (SELECT 1 FROM upd)
        RETURNING id, "userId", "username", "firstName", "lastName", "levelId"
      )
      SELECT * FROM upd
      UNION ALL
      SELECT * FROM ins
      LIMIT 1;
    `;
    const { rows } = await pool.query(upsertSql, [
      orgId,
      String(userId),
      username ?? null,
      firstName ?? null,
      lastName ?? null,
    ]);
    const cli = rows[0];
    if (!cli) {
      return NextResponse.json({ error: "Upsert failed" }, { status: 500 });
    }

    // No level yet? Return early (client can show a friendly message)
    if (!cli.levelId) {
      return NextResponse.json({ level: null });
    }

    // Fetch level once
    const levSql = `
      SELECT id, name, image, "levelUpMessage", "levelUpMessageGroup"
        FROM "affiliateLevels"
       WHERE id = $1 AND "organizationId" = $2
       LIMIT 1
    `;
    const { rows: levRows } = await pool.query(levSql, [cli.levelId, orgId]);
    const lvl = levRows[0];
    if (!lvl) {
      return NextResponse.json({ level: null });
    }

    // Prepare safe substitutions
    const rawDisplay =
      (cli.username ? `@${cli.username}` : (cli.firstName || cli.lastName || "Member"));
    const display = escapeHtml(String(rawDisplay));
    const mention = `<a href="tg://user?id=${escapeHtml(String(cli.userId))}">${display}</a>`;

    const pmText = (sanitizeHtml(lvl.levelUpMessage) || `🎉 You’re at <b>${escapeHtml(lvl.name)}</b> level – awesome work, ${display}!`)
      .replace(/{level_name}/g, escapeHtml(lvl.name))
      .replace(/{user}/g, display);

    const groupText = (sanitizeHtml(lvl.levelUpMessageGroup) || `🎉 ${mention} is now <b>${escapeHtml(lvl.name)}</b>!`)
      .replace(/{level_name}/g, escapeHtml(lvl.name))
      .replace(/{user}/g, display)
      .replace(/{mention}/g, mention);

    // Absolute image URL if needed
    let imageUrl: string | null = lvl.image ?? null;
    if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
      const base = process.env.NEXT_PUBLIC_BASE_URL || process.env.APP_BASE_URL || "";
      imageUrl = base ? joinUrl(base, imageUrl) : imageUrl;
    }

    return NextResponse.json({
      level: { id: lvl.id, name: lvl.name },
      pmText,
      groupText,
      imageUrl,
    });
  } catch (err) {
    console.error("[POST /affiliate/commands/mylevel]", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
