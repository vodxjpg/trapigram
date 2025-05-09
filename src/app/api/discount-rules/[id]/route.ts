// src/app/api/discount-rules/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getContext } from "@/lib/context";
import { v4 as uuidv4 } from "uuid";

const paramsSchema = z.object({ id: z.string().uuid() });
const stepSchema = z.object({
  fromUnits: z.number().min(1),
  toUnits: z.number().min(1),
  discountAmount: z.number().positive(),
});
const productItemSchema = z
  .object({
    productId: z.string().uuid().nullable(),
    variationId: z.string().uuid().nullable(),
  })
  .refine((d) => d.productId || d.variationId, {
    message: "Must specify productId or variationId",
  });
const patchSchema = z.object({
  name: z.string().min(1).optional(),
  countries: z.array(z.string().length(2)).min(1).optional(),
  products: z.array(productItemSchema).min(1).optional(),
  steps: z.array(stepSchema).min(1).optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  const { id } = paramsSchema.parse(await params);

  const rule = await db
    .selectFrom("discountRules")
    .selectAll()
    .where("id", "=", id)
    .where("organizationId", "=", organizationId)
    .executeTakeFirst();
  if (!rule) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Safe parse for countries
  let countries: string[];
  if (Array.isArray(rule.countries)) {
    countries = rule.countries;
  } else if (typeof rule.countries === "string") {
    const raw = rule.countries.trim();
    if (raw.startsWith("[")) {
      try {
        countries = JSON.parse(raw);
      } catch {
        countries = raw
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim().replace(/^"|"$/g, ""));
      }
    } else {
      countries = raw.length ? raw.split(",").map((s) => s.trim()) : [];
    }
  } else {
    countries = [];
  }

  const products = await db
    .selectFrom("discountRuleProducts")
    .select(["productId", "variationId"])
    .where("discountRuleId", "=", id)
    .execute();

  const steps = await db
    .selectFrom("discountRuleSteps")
    .select(["fromUnits", "toUnits", "discountAmount"])
    .where("discountRuleId", "=", id)
    .execute();

  return NextResponse.json({
    ...rule,
    countries,
    products,
    steps,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  const { id } = paramsSchema.parse(await params);
  const body = patchSchema.parse(await req.json());
  const now = new Date();

  // update main record
  const updateData: any = { updatedAt: now };
  if (body.name) updateData.name = body.name;
  if (body.countries) updateData.countries = JSON.stringify(body.countries);

  await db
    .updateTable("discountRules")
    .set(updateData)
    .where("id", "=", id)
    .execute();

  // replace steps if provided
  if (body.steps) {
    await db
      .deleteFrom("discountRuleSteps")
      .where("discountRuleId", "=", id)
      .execute();
    for (const s of body.steps) {
      await db
        .insertInto("discountRuleSteps")
        .values({
          id: uuidv4(),
          discountRuleId: id,
          fromUnits: s.fromUnits,
          toUnits: s.toUnits,
          discountAmount: s.discountAmount,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
    }
  }

  // replace products if provided
  if (body.products) {
    await db
      .deleteFrom("discountRuleProducts")
      .where("discountRuleId", "=", id)
      .execute();
    for (const p of body.products) {
      await db
        .insertInto("discountRuleProducts")
        .values({
          id: uuidv4(),
          discountRuleId: id,
          productId: p.productId,
          variationId: p.variationId,
          createdAt: now,
        })
        .execute();
    }
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const { id } = paramsSchema.parse(await params);

  await db
    .deleteFrom("discountRuleProducts")
    .where("discountRuleId", "=", id)
    .execute();
  await db
    .deleteFrom("discountRuleSteps")
    .where("discountRuleId", "=", id)
    .execute();
  await db
    .deleteFrom("discountRules")
    .where("id", "=", id)
    .execute();

  return NextResponse.json({ success: true });
}
