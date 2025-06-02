/* /src/app/api/notification/groups/route.ts */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getContext } from "@/lib/context";
import { v4 as uuidv4 } from "uuid";

/* ─────────────── validation ─────────────── */
const createSchema = z.object({
  name: z.string().min(1),
  countries: z.array(z.string().length(2)).min(1, "Select at least one country"),
  groupId: z.string().min(1),
});

/* ─────────────── GET – all groups ─────────────── */
export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const rows = await db
    .selectFrom("notificationGroups")
    .selectAll()
    .where("organizationId", "=", ctx.organizationId)
    .execute();

  /* parse JSON string → array for the client */
  const groups = rows.map((g) => ({
    ...g,
    countries: Array.isArray(g.countries) ? g.countries : JSON.parse(g.countries || "[]"),
  }));

  return NextResponse.json({ groups });
}

/* ─────────────── POST – create group ─────────────── */
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
    .insertInto("notificationGroups")
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
