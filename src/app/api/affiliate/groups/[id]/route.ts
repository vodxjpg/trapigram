/* /src/app/api/affiliate/groups/[id]/route.ts */
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getContext } from "@/lib/context";

const patchSchema = z.object({
  groupName: z.string().min(1).optional(),
  points: z
    .coerce
    .number()
    .int()
    .optional()
    .transform((p) => (p === undefined ? p : Math.max(p, 1))),
});

/**
 * Update an affiliate group
 */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  if (Object.keys(body).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  await db
    .updateTable("affiliateGroups")
    .set({ ...body, updatedAt: new Date() })
    .where("id", "=", id)
    .where("organizationId", "=", ctx.organizationId)
    .execute();

  return NextResponse.json({ id, updated: true });
}

/**
 * Delete an affiliate group
 */
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  await db
    .deleteFrom("affiliateGroups")
    .where("id", "=", id)
    .where("organizationId", "=", ctx.organizationId)
    .execute();

  return NextResponse.json({ id, deleted: true });
}
