// src/app/api/discount-rules/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getContext } from "@/lib/context";
import { v4 as uuidv4 } from "uuid";

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
const bodySchema = z.object({
  name: z.string().min(1),
  countries: z.array(z.string().length(2)).min(1),
  products: z.array(productItemSchema).min(1),
  steps: z.array(stepSchema).min(1),
});

export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  const rules = await db
    .selectFrom("discountRules")
    .selectAll()
    .where("organizationId", "=", organizationId)
    .execute();

  const discountRules = await Promise.all(
    rules.map(async (r) => {
      // Safe parse for countries
      let countries: string[];
      if (Array.isArray(r.countries)) {
        countries = r.countries;
      } else if (typeof r.countries === "string") {
        const raw = r.countries.trim();
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
        .where("discountRuleId", "=", r.id)
        .execute();

      const steps = await db
        .selectFrom("discountRuleSteps")
        .select(["fromUnits", "toUnits", "discountAmount"])
        .where("discountRuleId", "=", r.id)
        .execute();

      return {
        ...r,
        countries,
        products,
        steps,
      };
    })
  );

  return NextResponse.json({ discountRules });
}

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  const body = bodySchema.parse(await req.json());
  const ruleId = uuidv4();
  const now = new Date();

  await db
    .insertInto("discountRules")
    .values({
      id: ruleId,
      organizationId,
      name: body.name,
      countries: JSON.stringify(body.countries),
      createdAt: now,
      updatedAt: now,
    })
    .execute();

  for (const step of body.steps) {
    await db
      .insertInto("discountRuleSteps")
      .values({
        id: uuidv4(),
        discountRuleId: ruleId,
        fromUnits: step.fromUnits,
        toUnits: step.toUnits,
        discountAmount: step.discountAmount,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
  }

  for (const p of body.products) {
    await db
      .insertInto("discountRuleProducts")
      .values({
        id: uuidv4(),
        discountRuleId: ruleId,
        productId: p.productId,
        variationId: p.variationId,
        createdAt: now,
      })
      .execute();
  }

  return NextResponse.json({ success: true, ruleId }, { status: 201 });
}
