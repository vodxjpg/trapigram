/* /src/app/api/notification/groups/route.ts */
export const runtime = "nodejs";
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
/* ─────────────── POST – create or merge group ─────────────── */
export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  let data: z.infer<typeof createSchema>;
  try {
    data = createSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  // Optional: allow ?mode=replace to explicitly overwrite
  const mode = req.nextUrl.searchParams.get("mode") || "merge";
  const NORM = (s: string) => s.toUpperCase();

  const existing = await db
    .selectFrom("notificationGroups")
    .select(["id", "name", "countries"])
    .where("organizationId", "=", ctx.organizationId)
    .where("groupId", "=", data.groupId)
    .executeTakeFirst();

  if (existing) {
    // parse existing countries -> array
    const existingArr: string[] = Array.isArray(existing.countries)
      ? (existing.countries as unknown as string[])
      : JSON.parse(existing.countries || "[]");

    // merge or replace
    const nextCountries =
      mode === "replace"
        ? Array.from(new Set(data.countries.map(NORM)))
        : Array.from(new Set([...existingArr.map(NORM), ...data.countries.map(NORM)]));

    await db
      .updateTable("notificationGroups")
      .set({
        name: data.name ?? existing.name,
        countries: JSON.stringify(nextCountries),
        updatedAt: new Date(),
      })
      .where("id", "=", existing.id)
      .execute();

    return NextResponse.json(
      { id: existing.id, ...data, countries: nextCountries, updated: true, mode },
      { status: 200 }
    );
  }

  // create new row
  const id = uuidv4();
  const normed = Array.from(new Set(data.countries.map(NORM)));
  await db
    .insertInto("notificationGroups")
    .values({
      id,
      organizationId: ctx.organizationId,
      name: data.name,
      countries: JSON.stringify(normed),
      groupId: data.groupId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .execute();

  return NextResponse.json({ id, ...data, countries: normed, created: true }, { status: 201 });
}

