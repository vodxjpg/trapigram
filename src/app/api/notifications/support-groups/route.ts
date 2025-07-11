/* /src/app/api/ticket-support-groups/route.ts */
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getContext } from "@/lib/context";
import { v4 as uuidv4 } from "uuid";

const createSchema = z.object({
  name: z.string().min(1),
  countries: z.array(z.string().length(2)).min(1),
  groupId: z.string().min(1),
});

export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const rows = await db
    .selectFrom("ticketSupportGroups")
    .selectAll()
    .where("organizationId", "=", ctx.organizationId)
    .execute();

  const groups = rows.map((g) => ({
    ...g,
    countries: Array.isArray(g.countries)
      ? g.countries
      : JSON.parse(g.countries || "[]"),
  }));
  return NextResponse.json({ groups });
}

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
    .insertInto("ticketSupportGroups")
    .values({
      id,
      organizationId: ctx.organizationId,
      name: data.name,
      countries: JSON.stringify(data.countries),
      groupId: data.groupId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .execute();

  return NextResponse.json({ id, ...data }, { status: 201 });
}
