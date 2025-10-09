// /src/app/api/notifications/support-groups/[id]/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getContext } from "@/lib/context";

const countryCode = z.union([z.string().length(2), z.literal("*")]);

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  countries: z.array(countryCode).min(1).optional(), // PATCH replaces countries if provided
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

  const update: Record<string, any> = { updatedAt: new Date() };
  if ("name" in body) update.name = body.name;
  if ("countries" in body) update.countries = JSON.stringify(body.countries);

  await db
    .updateTable("ticketSupportGroups")
    .set(update)
    .where("id", "=", params.id)
    .where("organizationId", "=", ctx.organizationId)
    .execute();

  return NextResponse.json({ id: params.id, updated: true }, { status: 200 });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  await db
    .deleteFrom("ticketSupportGroups")
    .where("id", "=", params.id)
    .where("organizationId", "=", ctx.organizationId)
    .execute();

  return NextResponse.json({ id: params.id, deleted: true }, { status: 200 });
}
