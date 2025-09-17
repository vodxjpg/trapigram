// src/app/api/tier-pricing/[id]/active/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getContext } from "@/lib/context";

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z.object({ active: z.boolean() });

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  const { id } = paramsSchema.parse(await params);
  const { active } = bodySchema.parse(await req.json());

  await db
    .updateTable("tierPricings")
    .set({ active, updatedAt: new Date() })
    .where("id", "=", id)
    .where("organizationId", "=", organizationId)
    .execute();

  return NextResponse.json({ success: true });
}
