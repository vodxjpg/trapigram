// File: src/app/api/sections/route.ts
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getContext } from "@/lib/context";
import { sanitizeSectionHtml } from "@/lib/sanitize-html";

const SectionSchema = z.object({
  name: z.string().min(1),
  title: z.string().min(1),
  content: z.string().min(1),
  videoUrl: z
    .string()
    .trim()
    .nullable()
    .optional()
    .refine(
      (v) =>
        v === null ||
        /^\/uploads\/.+/.test(v) ||
        /^https?:\/\/.+/.test(v),
      { message: "Invalid video URL" }
    ),
  parentSectionId: z.string().uuid().nullable().optional(),
});

/* ─────────────────────────────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const depth = Number(new URL(req.url).searchParams.get("depth") ?? 0);
  if (Number.isNaN(depth) || depth < 0) {
    return NextResponse.json(
      { error: "depth must be a positive integer" },
      { status: 400 }
    );
  }

  const rows = await db
    .withRecursive("tree", (qb) =>
      qb
        .selectFrom("sections")
        .selectAll()
        .where("organizationId", "=", ctx.organizationId)
        .where("parentSectionId", "is", null)
        .unionAll((qb) =>
          qb
            .selectFrom("sections")
            .innerJoin("tree", "tree.id", "sections.parentSectionId")
            .selectAll("sections")
        )
    )
    .selectFrom("tree")
    .selectAll()
    .execute();

  const list = depth === 0 ? rows.filter((r) => r.parentSectionId === null) : rows;
  return NextResponse.json({ sections: list });
}

/* ─────────────────────────────────────────────────────────────── */
export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const body = await req.json().catch(() => null);
  const parsed = SectionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { name, title, content, videoUrl = null, parentSectionId = null } =
    parsed.data;

  if (parentSectionId) {
    const ok = await db
      .selectFrom("sections")
      .select("id")
      .where("id", "=", parentSectionId)
      .where("organizationId", "=", ctx.organizationId)
      .executeTakeFirst();
    if (!ok) {
      return NextResponse.json(
        { error: "parentSectionId not found in your organization" },
        { status: 400 }
      );
    }
  }

  const [section] = await db
    .insertInto("sections")
    .values({
      organizationId: ctx.organizationId,
      parentSectionId,
      name,
      title,
      content: sanitizeSectionHtml(content),
      videoUrl,
    })
    .returningAll()
    .execute();

  return NextResponse.json({ section }, { status: 201 });
}
