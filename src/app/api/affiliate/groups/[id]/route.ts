/* /src/app/api/affiliate/groups/[id]/route.ts */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getContext } from "@/lib/context";

const patchSchema = z.object({
  points: z.coerce.number().int().min(0).optional(),
  groupName: z.string().min(1).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  if (Object.keys(body).length === 0)
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  await db
    .updateTable("affiliateGroups")
    .set({ ...body, updatedAt: new Date() })
    .where("id", "=", params.id)
    .where("organizationId", "=", ctx.organizationId)
    .execute();

  return NextResponse.json({ id: params.id, updated: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  await db
    .deleteFrom("affiliateGroups")
    .where("id", "=", params.id)
    .where("organizationId", "=", ctx.organizationId)
    .execute();

  return NextResponse.json({ id: params.id, deleted: true });
}
