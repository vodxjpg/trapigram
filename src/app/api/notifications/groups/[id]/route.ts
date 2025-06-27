/* /src/app/api/notification/groups/[id]/route.ts */
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getContext } from "@/lib/context";

/* ─────────────── PATCH / DELETE schema ─────────────── */
const patchSchema = z.object({
  name: z.string().min(1).optional(),
  countries: z.array(z.string().length(2)).min(1).optional(),
});

/* ─────────────── PATCH – update group ─────────────── */
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
    .updateTable("notificationGroups")
    .set({
      ...("name" in body ? { name: body.name } : {}),
      ...("countries" in body ? { countries: JSON.stringify(body.countries) } : {}),
      updatedAt: new Date(),
    })
    .where("id", "=", params.id)
    .where("organizationId", "=", ctx.organizationId)
    .execute();

  return NextResponse.json({ id: params.id, updated: true });
}

/* ─────────────── DELETE – remove group ─────────────── */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  await db
    .deleteFrom("notificationGroups")
    .where("id", "=", params.id)
    .where("organizationId", "=", ctx.organizationId)
    .execute();

  return NextResponse.json({ id: params.id, deleted: true });
}
