// /src/app/api/notifications/support-groups/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getContext } from "@/lib/context";
import { v4 as uuidv4 } from "uuid";

/* ────────────────────────────────────────────────────────────────── *
 * Schemas                                                            *
 * ────────────────────────────────────────────────────────────────── */

const countryCode = z.union([z.string().length(2), z.literal("*")]);

const createSchema = z.object({
  name: z.string().min(1),
  countries: z.array(countryCode).min(1),
  groupId: z.string().min(1), // Telegram chat id as string
});

/* ────────────────────────────────────────────────────────────────── *
 * Helpers                                                            *
 * ────────────────────────────────────────────────────────────────── */

function parseCountries(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  try {
    const arr = JSON.parse((raw as string) || "[]");
    return Array.isArray(arr) ? (arr as string[]) : [];
  } catch {
    return [];
  }
}

/* ────────────────────────────────────────────────────────────────── *
 * GET — list (paginated)                                             *
 * ?page=1&pageSize=100                                               *
 * ────────────────────────────────────────────────────────────────── */

export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(searchParams.get("pageSize")) || 100));
  const offset = (page - 1) * pageSize;

  // total count
  const totalRowsRes = await db
    .selectFrom("ticketSupportGroups")
    .select(({ fn }) => [fn.count<number>("id").as("cnt")])
    .where("organizationId", "=", ctx.organizationId)
    .executeTakeFirst();
  const totalRows = Number(totalRowsRes?.cnt || 0);
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));

  // page rows
  const rows = await db
    .selectFrom("ticketSupportGroups")
    .selectAll()
    .where("organizationId", "=", ctx.organizationId)
    .limit(pageSize)
    .offset(offset)
    .orderBy("createdAt desc")
    .execute();

  const groups = rows.map((g) => ({
    ...g,
    countries: parseCountries(g.countries),
  }));

  return NextResponse.json({ groups, page, pageSize, totalPages, totalRows }, { status: 200 });
}

/* ────────────────────────────────────────────────────────────────── *
 * POST — upsert by (organizationId, groupId)                         *
 * ?mode=replace  → replace countries                                 *
 * default (no mode) → merge+unique countries                         *
 * ────────────────────────────────────────────────────────────────── */

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const url = new URL(req.url);
  const mode = (url.searchParams.get("mode") || "").toLowerCase(); // "replace" | ""

  let data: z.infer<typeof createSchema>;
  try {
    data = createSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

    // Normalize countries to UPPERCASE (and trim), to match dispatcher comparisons
  const normCountries = data.countries.map((c) => (c === "*" ? "*" : c.toUpperCase().trim()));

  // Look up existing group by (organizationId, groupId)
  const existing = await db
    .selectFrom("ticketSupportGroups")
    .selectAll()
    .where("organizationId", "=", ctx.organizationId)
    .where("groupId", "=", data.groupId)
    .executeTakeFirst();

  const now = new Date();

  if (existing) {
    const prevCountries = parseCountries(existing.countries);
    const nextCountries =
      mode === "replace"
      ? normCountries
      : Array.from(new Set([...(prevCountries || []), ...normCountries]));

    await db
      .updateTable("ticketSupportGroups")
      .set({
        name: data.name ?? existing.name,
        countries: JSON.stringify(nextCountries),
        updatedAt: now,
      })
      .where("id", "=", existing.id)
      .where("organizationId", "=", ctx.organizationId)
      .execute();

    return NextResponse.json(
      { id: existing.id, name: data.name ?? existing.name, countries: nextCountries, groupId: data.groupId },
      { status: 200 },
    );
  }

  // Insert new
  const id = uuidv4();
  await db
    .insertInto("ticketSupportGroups")
    .values({
      id,
      organizationId: ctx.organizationId,
      name: data.name,
      countries: JSON.stringify(normCountries),
      groupId: data.groupId,
      createdAt: now,
      updatedAt: now,
    })
    .execute();

  return NextResponse.json({ id, ...data }, { status: 201 });
}
