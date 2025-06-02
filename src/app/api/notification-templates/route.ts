// src/app/api/notification-templates/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { getContext } from "@/lib/context";
import { db } from "@/lib/db";

const NOTIF_TYPES = ["order_placed"] as const;
const createSchema = z.object({
  type: z.enum(NOTIF_TYPES),
  role: z.enum(["admin", "user"]),
  countries: z.array(z.string().length(2)).min(1, "Select at least one country"),
  subject: z.string().min(1),
  message: z.string().min(1),
});

export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const rows = await db
    .selectFrom("notificationTemplates")
    .selectAll()
    .where("organizationId", "=", ctx.organizationId)
    .execute();

  /* parse to array for client */
  const parsed = rows.map((r) => ({
    ...r,
    countries: Array.isArray(r.countries) ? r.countries : JSON.parse(r.countries || "[]"),
  }));

  return NextResponse.json(parsed, { status: 200 });
}

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError)
      return NextResponse.json({ error: err.errors }, { status: 400 });
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const id = crypto.randomUUID();
  await db
    .insertInto("notificationTemplates")
    .values({
      id,
      organizationId: ctx.organizationId,
      ...body,
      /* stringify array for storage */
      countries: JSON.stringify(body.countries),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .execute();

  return NextResponse.json({ id }, { status: 201 });
}
