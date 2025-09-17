// src/app/api/tier-pricing/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getContext } from "@/lib/context";
import { v4 as uuidv4 } from "uuid";

const LOG = "[TIER_PRICING_ROOT]";
const mkRid = () => uuidv4().slice(0, 8);

/* ─── schemas ─────────────────────────── */
const stepSchema = z.object({
  fromUnits: z.number().min(1),
  toUnits: z.number().min(1),
  price: z.number().positive(),
});

/**
 * IMPORTANT: shared product copies use non-UUID string IDs like "PROD-xxxx" / "VAR-xxxx".
 * We must NOT enforce UUID shape here, only non-empty strings (or null).
 */
const productItemSchema = z
  .object({
    productId: z.string().min(1).nullable(),
    variationId: z.string().min(1).nullable(),
  })
  .refine((d) => d.productId || d.variationId, {
    message: "Must specify productId or variationId",
  });

const bodySchema = z.object({
  name: z.string().min(1),
  countries: z.array(z.string().length(2)).min(1),
  products: z.array(productItemSchema).min(1),
  steps: z.array(stepSchema).min(1),
  // NEW: client targeting (priority over general rules)
  clients: z.array(z.string().min(1)).optional().default([]),
});

/* ─── GET list ────────────────────────── */
export async function GET(req: NextRequest) {
  const rid = mkRid();
  const t0 = Date.now();
  try {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId } = ctx;
    console.log(`${LOG}#${rid} GET start`, { organizationId });

    const rows = await db
      .selectFrom("tierPricings")
      .selectAll()
      .where("organizationId", "=", organizationId)
      .execute();

    console.log(`${LOG}#${rid} fetched tierPricings`, { count: rows.length });

    const tierPricings = await Promise.all(
      rows.map(async (r) => {
        const countries =
          typeof (r as any).countries === "string"
            ? JSON.parse((r as any).countries || "[]")
            : (r as any).countries;

        const products = await db
          .selectFrom("tierPricingProducts")
          .select(["productId", "variationId"])
          .where("tierPricingId", "=", r.id)
          .execute();

        const steps = await db
          .selectFrom("tierPricingSteps")
          .select(["fromUnits", "toUnits", "price"])
          .where("tierPricingId", "=", r.id)
          .execute();

        // NEW: targeted clients
        const clientRows = await db
          .selectFrom("tierPricingClients")
          .select(["clientId"])
          .where("tierPricingId", "=", r.id)
          .execute();

        return {
          ...r,
          countries,
          products,
          steps,
          clients: clientRows.map((c) => c.clientId),
        };
      })
    );

    console.log(`${LOG}#${rid} done`, {
      ms: Date.now() - t0,
      expandedCount: tierPricings.length,
    });
    return NextResponse.json({ tierPricings });
  } catch (err) {
    console.error(`${LOG}#${rid} GET error`, err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/* ─── POST create ─────────────────────── */
export async function POST(req: NextRequest) {
  const rid = mkRid();
  const t0 = Date.now();
  try {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId } = ctx;

    let raw: unknown;
    try {
      raw = await req.json();
    } catch (e) {
      console.error(`${LOG}#${rid} POST body parse error`, e);
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    let body: z.infer<typeof bodySchema>;
    try {
      body = bodySchema.parse(raw);
    } catch (e) {
      if (e instanceof z.ZodError) {
        console.error(`${LOG}#${rid} POST Zod validation error`, {
          issues: e.issues,
        });
        return NextResponse.json({ error: e.issues }, { status: 400 });
      }
      throw e;
    }

    console.log(`${LOG}#${rid} POST validated`, {
      organizationId,
      name: body.name,
      countries: body.countries,
      productsCount: body.products.length,
      stepsCount: body.steps.length,
      clientsCount: body.clients?.length ?? 0,
      firstProduct: body.products[0],
      firstStep: body.steps[0],
    });

    const pricingId = uuidv4();
    const now = new Date();

    await db
      .insertInto("tierPricings")
      .values({
        id: pricingId,
        organizationId,
        active: true,
        name: body.name,
        countries: JSON.stringify(body.countries),
        createdAt: now,
        updatedAt: now,
      })
      .execute();

    for (const s of body.steps) {
      await db
        .insertInto("tierPricingSteps")
        .values({
          id: uuidv4(),
          tierPricingId: pricingId,
          fromUnits: s.fromUnits,
          toUnits: s.toUnits,
          price: s.price,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
    }

    for (const p of body.products) {
      await db
        .insertInto("tierPricingProducts")
        .values({
          id: uuidv4(),
          tierPricingId: pricingId,
          productId: p.productId,
          variationId: p.variationId,
          createdAt: now,
        })
        .execute();
    }

    // NEW: targeted clients (insert outside product loop)
    if (body.clients?.length) {
      for (const clientId of body.clients) {
        await db
          .insertInto("tierPricingClients")
          .values({
            id: uuidv4(),
            tierPricingId: pricingId,
            clientId,
            createdAt: now,
          })
          .execute();
      }
    }

    console.log(`${LOG}#${rid} POST created`, {
      pricingId,
      ms: Date.now() - t0,
      insertedSteps: body.steps.length,
      insertedProducts: body.products.length,
      insertedClients: body.clients?.length ?? 0,
    });
    return NextResponse.json({ success: true, pricingId }, { status: 201 });
  } catch (err) {
    console.error(`${LOG}#${rid} POST error`, err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
