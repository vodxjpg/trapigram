// File: src/app/api/sections/[id]/route.ts
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getContext } from "@/lib/context";
import { sanitizeSectionHtml } from "@/lib/sanitize-html";

/* ──────────────────────── Schemas ───────────────────────────── */
const ParamsSchema = z.object({ id: z.string().uuid() });

const UpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    content: z.string().min(1).optional(),
    videoUrl: z
      .string()
      .trim()
      .transform((v) => (v.length === 0 ? null : v))
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
  })
  .refine((o) => Object.keys(o).length > 0, {
    message: "At least one field must be provided",
  });

/* ───────────────────────── GET /:id ─────────────────────────── */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const { id } = ParamsSchema.parse(await context.params);
  const section = await db
    .selectFrom("sections")
    .selectAll()
    .where("id", "=", id)
    .where("organizationId", "=", ctx.organizationId)
    .executeTakeFirst();

  return section
    ? NextResponse.json({ section })
    : NextResponse.json({ error: "Section not found" }, { status: 404 });
}

/* ───────────────────────── PUT /:id ─────────────────────────── */
export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const { id } = ParamsSchema.parse(await context.params);
  const body = await req.json().catch(() => null);
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  if (data.parentSectionId) {
    const ok = await db
      .selectFrom("sections")
      .select("id")
      .where("id", "=", data.parentSectionId)
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
    .updateTable("sections")
    .set({
      ...(data.name && { name: data.name }),
      ...(data.title && { title: data.title }),
      ...(data.content && { content: sanitizeSectionHtml(data.content) }),
      ...(data.videoUrl !== undefined && { videoUrl: data.videoUrl }),
      ...(data.parentSectionId !== undefined && {
        parentSectionId: data.parentSectionId,
      }),
      updatedAt: new Date(),
    })
    .where("id", "=", id)
    .where("organizationId", "=", ctx.organizationId)
    .returningAll()
    .execute();

  return NextResponse.json({ section });
}

/* ──────────────────────── DELETE /:id ───────────────────────── */
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const { id } = ParamsSchema.parse(await context.params);
  await db
    .deleteFrom("sections")
    .where("id", "=", id)
    .where("organizationId", "=", ctx.organizationId)
    .executeTakeFirst();

  return NextResponse.json({ success: true });
}
