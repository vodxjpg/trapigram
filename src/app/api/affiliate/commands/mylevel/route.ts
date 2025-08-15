import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";

function sanitizeHtml(s: string | null | undefined) {
  if (!s) return "";
  // minimal server-side clean; the bot still uses sanitize_html too
  return s.replace(/<\/p>/gi, "\n").replace(/<p>/gi, "").trim();
}

export async function POST(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get("organizationId");
  if (!orgId) {
    return NextResponse.json({ error: "organizationId required" }, { status: 400 });
  }
  const { userId, username, firstName, lastName } = await req.json();

  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  try {
    // 1) upsert client on (organizationId, userId) — adjust ON CONFLICT target if needed
    const upsertSql = `
      INSERT INTO clients ("organizationId","userId","username","firstName","lastName")
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT ("organizationId","userId")
      DO UPDATE SET "username" = EXCLUDED."username",
                    "firstName" = EXCLUDED."firstName",
                    "lastName"  = EXCLUDED."lastName"
      RETURNING id, "userId", username, "firstName", "lastName", "levelId"
    `;
    const {
      rows: [cli],
    } = await pool.query(upsertSql, [orgId, String(userId), username ?? null, firstName ?? null, lastName ?? null]);

    if (!cli?.levelId) {
      return NextResponse.json({ level: null }); // not reached any level
    }

    // 2) fetch level in the same request
    const levSql = `
      SELECT id, name, image, "levelUpMessage", "levelUpMessageGroup"
        FROM "affiliateLevels"
       WHERE id = $1 AND "organizationId" = $2
       LIMIT 1
    `;
    const {
      rows: [lvl],
    } = await pool.query(levSql, [cli.levelId, orgId]);

    if (!lvl) {
      return NextResponse.json({ level: null });
    }

    // 3) prepare substituted texts (bot mentions username safely)
    const display =
      (cli.username ? `@${cli.username}` : (cli.firstName || cli.lastName || "Member"));
    const mention = `<a href="tg://user?id=${cli.userId}">${display}</a>`;

    const pmText = (sanitizeHtml(lvl.levelUpMessage) || `🎉 You’re at <b>${lvl.name}</b> level – awesome work, ${display}!`)
      .replace(/{level_name}/g, lvl.name)
      .replace(/{user}/g, display);

    const groupText = (sanitizeHtml(lvl.levelUpMessageGroup) || `🎉 ${mention} is now <b>${lvl.name}</b>!`)
      .replace(/{level_name}/g, lvl.name)
      .replace(/{user}/g, display)
      .replace(/{mention}/g, mention);

    // 4) absolute image URL if needed
    let imageUrl = lvl.image as string | null;
    if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
      const base = process.env.NEXT_PUBLIC_BASE_URL || process.env.APP_BASE_URL || "";
      imageUrl = base ? `${base}${imageUrl}` : imageUrl;
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
