/* /src/app/api/affiliate/groups/route.ts */
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getContext } from "@/lib/context";
import { v4 as uuidv4 } from "uuid";

const createSchema = z.object({
  groupId: z.string().min(1),
  groupName: z.string().min(1),
  points: z.coerce.number().int().min(0),
  platform: z.enum(["telegram"]).default("telegram"),
});

/* GET – all groups for org */
export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const rows = await db
    .selectFrom("affiliateGroups")
    .selectAll()
    .where("organizationId", "=", ctx.organizationId)
    .execute();
  return NextResponse.json({ groups: rows });
}

/* POST – bot (or future admin) inserts a new raw group row */
export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  let data: z.infer<typeof createSchema>;
  try {
    data = createSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const id = uuidv4();
  await db
    .insertInto("affiliateGroups")
    .values({
      id,
      organizationId: ctx.organizationId,
      groupId: data.groupId,
      groupName: data.groupName,
      points: data.points,
      platform: data.platform,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .execute();

  return NextResponse.json({ id, ...data }, { status: 201 });
}
