// File: src/app/api/affiliate/settings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getContext } from "@/lib/context";

const schema = z.object({
  pointsPerReferral: z.coerce.number().int().min(0),
  pointsPerReview: z.coerce.number().int().min(0),
  spendingNeeded: z.coerce.number().min(0),
  pointsPerSpending: z.coerce.number().int().min(0),
  monetaryValuePerPoint: z.coerce.number().min(0),
});

/*──────── GET – return org settings or defaults ────────*/
export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const row = await db
    .selectFrom("affiliateSettings")
    .selectAll()
    .where("organizationId", "=", ctx.organizationId)
    .executeTakeFirst();

  return NextResponse.json(
    row ?? {
      organizationId: ctx.organizationId,
      pointsPerReferral: 0,
      pointsPerReview: 0,
      spendingNeeded: "0",
      pointsPerSpending: 0,
      monetaryValuePerPoint: "0",
      createdAt: null,
      updatedAt: null,
    },
  );
}

/*──────── PUT – upsert settings ────────*/
export async function PUT(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const data = schema.parse(await req.json());

    await db
      .insertInto("affiliateSettings")
      .values({
        organizationId: ctx.organizationId,
        pointsPerReferral: data.pointsPerReferral,
        pointsPerReview: data.pointsPerReview,
        spendingNeeded: data.spendingNeeded.toString(),
        pointsPerSpending: data.pointsPerSpending,
        monetaryValuePerPoint: data.monetaryValuePerPoint.toString(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflict((oc) =>
        oc.column("organizationId").doUpdateSet({
          pointsPerReferral: data.pointsPerReferral,
          pointsPerReview: data.pointsPerReview,
          spendingNeeded: data.spendingNeeded.toString(),
          pointsPerSpending: data.pointsPerSpending,
          monetaryValuePerPoint: data.monetaryValuePerPoint.toString(),
          updatedAt: new Date(),
        }),
      )
      .execute();

    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.errors }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
