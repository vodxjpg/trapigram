// src/app/api/affiliate-products/[id]/route.ts
import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { auth } from "@/lib/auth"

/* ────────────────────────────────────────────────────────────── */
/* schemas                                                        */
/* ────────────────────────────────────────────────────────────── */
const pointsMap = z.record(z.string(), z.number())
const patchSchema = z.object({
  title: z.string().optional(),
  description: z.string().nullable().optional(),
  image: z.string().nullable().optional(),
  sku: z.string().optional(),
  status: z.enum(["published", "draft"]).optional(),
  pointsPrice: pointsMap.optional(),
})

/* ────────────────────────────────────────────────────────────── */
/* GET – single affiliate product                                 */
/* ────────────────────────────────────────────────────────────── */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth.api.getSession({ headers: _req.headers })
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const organizationId = session.session.activeOrganizationId
  if (!organizationId)
    return NextResponse.json({ error: "No org" }, { status: 400 })

  const { id } = params
  const row = await db
    .selectFrom("products as p")
    .innerJoin("affiliateProducts as ap", "ap.productId", "p.id")
    .select([
      "p.id",
      "p.title",
      "p.description",
      "p.image",
      "p.sku",
      "p.status",
      "p.productType",
      "p.allowBackorders",
      "p.manageStock",
      "ap.pointsPrice",
      "p.createdAt",
    ])
    .where("p.id", "=", id)
    .where("p.organizationId", "=", organizationId)
    .executeTakeFirst()

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return NextResponse.json({
    product: {
      ...row,
      pointsPrice:
        typeof row.pointsPrice === "string"
          ? JSON.parse(row.pointsPrice)
          : row.pointsPrice,
    },
  })
}

/* ────────────────────────────────────────────────────────────── */
/* PATCH – update                                                 */
/* ────────────────────────────────────────────────────────────── */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth.api.getSession({ headers: req.headers })
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const organizationId = session.session.activeOrganizationId
  if (!organizationId)
    return NextResponse.json({ error: "No org" }, { status: 400 })

  const { id } = params
  const body = patchSchema.parse(await req.json())
  if (!Object.keys(body).length)
    return NextResponse.json({ message: "Nothing to update" })

  /* core product cols */
  await db
    .updateTable("products")
    .set({
      title: body.title,
      description: body.description,
      image: body.image,
      sku: body.sku,
      status: body.status,
      updatedAt: new Date(),
    })
    .where("id", "=", id)
    .where("organizationId", "=", organizationId)
    .execute()

  /* points map */
  if (body.pointsPrice) {
    await db
      .updateTable("affiliateProducts")
      .set({ pointsPrice: body.pointsPrice, updatedAt: new Date() })
      .where("productId", "=", id)
      .execute()
  }

  return NextResponse.json({ id, updated: true })
}

/* ────────────────────────────────────────────────────────────── */
/* DELETE – remove                                                */
/* ────────────────────────────────────────────────────────────── */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth.api.getSession({ headers: _req.headers })
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const organizationId = session.session.activeOrganizationId
  if (!organizationId)
    return NextResponse.json({ error: "No org" }, { status: 400 })

  const { id } = params

  await db.deleteFrom("affiliateProducts").where("productId", "=", id).execute()
  await db
    .deleteFrom("affiliateVariationPoints")
    .where(
      "variationId",
      "in",
      db
        .selectFrom("productVariations")
        .select("id")
        .where("productId", "=", id),
    )
    .execute()
  await db
    .deleteFrom("products")
    .where("id", "=", id)
    .where("organizationId", "=", organizationId)
    .execute()

  return NextResponse.json({ id, deleted: true })
}
