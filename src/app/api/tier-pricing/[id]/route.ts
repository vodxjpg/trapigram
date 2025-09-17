// /home/zodx/Desktop/trapigram/src/app/api/tier-pricing/[id]/route.ts
// src/app/api/tier-pricing/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getContext } from "@/lib/context";
import { v4 as uuidv4 } from "uuid";

const LOG = "[TIER_PRICING_ITEM]";
const mkRid = () => uuidv4().slice(0, 8);

/**
 * IMPORTANT: do not force UUID here — shared copies use non-UUID string IDs.
 */
const paramsSchema = z.object({ id: z.string().min(1) });

const stepSchema = z.object({
  fromUnits: z.number().min(1),
  toUnits: z.number().min(1),
  price: z.number().positive(),
});

const productItemSchema = z
  .object({
    productId: z.string().min(1).nullable(),
    variationId: z.string().min(1).nullable(),
  })
  .refine((d) => d.productId || d.variationId, {
    message: "Must specify productId or variationId",
  });

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  countries: z.array(z.string().length(2)).min(1).optional(),
  products: z.array(productItemSchema).min(1).optional(),
  steps: z.array(stepSchema).min(1).optional(),
  active: z.boolean().optional(),
  clients: z.array(z.string().min(1)).optional(),
});

/* ─── GET single ──────────────────────── */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rid = mkRid();
  const t0 = Date.now();
  try {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId } = ctx;
    const { id } = paramsSchema.parse(await params);
    console.log(`${LOG}#${rid} GET start`, { id, organizationId });

    const row = await db
      .selectFrom("tierPricings")
      .selectAll()
      .where("id", "=", id)
      .where("organizationId", "=", organizationId)
      .executeTakeFirst();

    if (!row) {
      console.warn(`${LOG}#${rid} GET not found`, { id });
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const countries =
      typeof (row as any).countries === "string"
        ? JSON.parse((row as any).countries || "[]")
        : (row as any).countries;

    const products = await db
      .selectFrom("tierPricingProducts")
      .select(["productId", "variationId"])
      .where("tierPricingId", "=", id)
      .execute();

    const steps = await db
      .selectFrom("tierPricingSteps")
      .select(["fromUnits", "toUnits", "price"])
      .where("tierPricingId", "=", id)
      .execute();

    const clientRows = await db
      .selectFrom("tierPricingClients")
      .select(["clientId"])
      .where("tierPricingId", "=", id)
      .execute();

    console.log(`${LOG}#${rid} GET done`, {
      ms: Date.now() - t0,
      steps: steps.length,
      products: products.length,
      clients: clientRows.length,
      countriesCount: (countries || []).length,
    });

    return NextResponse.json({
      ...row,
      countries,
      products,
      steps,
      clients: clientRows.map((c) => c.clientId),
    });
  } catch (err) {
    console.error(`${LOG}#${rid} GET error`, err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/* ─── PATCH update ────────────────────── */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rid = mkRid();
  const t0 = Date.now();
  try {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId } = ctx;
    const { id } = paramsSchema.parse(await params);

    let raw: any;
    try {
      raw = await req.json();
    } catch (e) {
      console.error(`${LOG}#${rid} PATCH body parse error`, e);
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    // ── BACKCOMPAT: map legacy "customers" → "clients" if necessary
    const normalized = {
      ...raw,
      clients: Array.isArray(raw?.clients)
        ? raw.clients
        : Array.isArray(raw?.customers)
        ? raw.customers
        : undefined, // undefined means "do not change clients"
    };

    let body: z.infer<typeof patchSchema>;
    try {
      body = patchSchema.parse(normalized);
    } catch (e) {
      if (e instanceof z.ZodError) {
        console.error(`${LOG}#${rid} PATCH Zod validation error`, {
          issues: e.issues,
        });
        return NextResponse.json({ error: e.issues }, { status: 400 });
      }
      throw e;
    }

    console.log(`${LOG}#${rid} PATCH start`, {
      id,
      organizationId,
      keys: Object.keys(body),
      stepsCount: body.steps?.length ?? 0,
      productsCount: body.products?.length ?? 0,
      clientsCount:
        Array.isArray(body.clients) ? body.clients.length : "(no change)",
      active: typeof body.active === "boolean" ? body.active : undefined,
      name: body.name,
      countries: body.countries,
    });

    const now = new Date();
    const updateCols: Record<string, any> = { updatedAt: now };
    if (body.name) updateCols.name = body.name;
    if (body.countries) updateCols.countries = JSON.stringify(body.countries);
    if (typeof body.active === "boolean") updateCols.active = body.active;

    await db
      .updateTable("tierPricings")
      .set(updateCols)
      .where("id", "=", id)
      .where("organizationId", "=", organizationId)
      .execute();

    if (body.steps) {
      await db
        .deleteFrom("tierPricingSteps")
        .where("tierPricingId", "=", id)
        .execute();
      for (const s of body.steps) {
        await db
          .insertInto("tierPricingSteps")
          .values({
            id: uuidv4(),
            tierPricingId: id,
            fromUnits: s.fromUnits,
            toUnits: s.toUnits,
            price: s.price,
            createdAt: now,
            updatedAt: now,
          })
          .execute();
      }
    }

    if (body.products) {
      await db
        .deleteFrom("tierPricingProducts")
        .where("tierPricingId", "=", id)
        .execute();
      for (const p of body.products) {
        await db
          .insertInto("tierPricingProducts")
          .values({
            id: uuidv4(),
            tierPricingId: id,
            productId: p.productId,
            variationId: p.variationId,
            createdAt: now,
          })
          .execute();
      }
    }

    // Update targeted clients only when provided
    if (Array.isArray(body.clients)) {
      await db
        .deleteFrom("tierPricingClients")
        .where("tierPricingId", "=", id)
        .execute();
      for (const clientId of body.clients) {
        await db
          .insertInto("tierPricingClients")
          .values({
            id: uuidv4(),
            tierPricingId: id,
            clientId,
            createdAt: now,
          })
          .execute();
      }
    }

    console.log(`${LOG}#${rid} PATCH done`, {
      ms: Date.now() - t0,
      setSteps: body.steps?.length ?? 0,
      setProducts: body.products?.length ?? 0,
      setClients: Array.isArray(body.clients) ? body.clients.length : "(no change)",
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(`${LOG}#${rid} PATCH error`, err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/* ─── DELETE ──────────────────────────── */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rid = mkRid();
  const t0 = Date.now();
  try {
    const { id } = paramsSchema.parse(await params);
    console.log(`${LOG}#${rid} DELETE start`, { id });

    await db
      .deleteFrom("tierPricingClients")
      .where("tierPricingId", "=", id)
      .execute();
    await db
      .deleteFrom("tierPricingProducts")
      .where("tierPricingId", "=", id)
      .execute();
    await db
      .deleteFrom("tierPricingSteps")
      .where("tierPricingId", "=", id)
      .execute();
    await db.deleteFrom("tierPricings").where("id", "=", id).execute();

    console.log(`${LOG}#${rid} DELETE done`, { ms: Date.now() - t0 });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(`${LOG}#${rid} DELETE error`, err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
