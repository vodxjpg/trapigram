import { NextRequest, NextResponse } from "next/server"
import { Pool } from "pg"
import { nanoid } from "nanoid" // or anything for generating IDs
import { auth } from "@/lib/auth"

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string

export async function POST(req: NextRequest) {
  try {
    const secret = req.headers.get("x-internal-secret")
    if (secret !== INTERNAL_API_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    const session = await auth.api.getSession({ headers: req.headers })
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { organizationId, warehouseName, countries } = await req.json() as {
      organizationId: string
      warehouseName: string
      countries: string[]
    }

    if (!organizationId) {
      return NextResponse.json({ error: "No organizationId provided" }, { status: 400 })
    }
    if (!warehouseName) {
      return NextResponse.json({ error: "No warehouseName provided" }, { status: 400 })
    }
    if (!countries || countries.length === 0) {
      return NextResponse.json({ error: "At least one country is required" }, { status: 400 })
    }

    // (A) We'll insert a new row in "warehouse" table
    // We store the array of countries as JSON in "countries" column
    // This is just an example using node-postgres. If you prefer Kysely, do that.
    const warehouseId = nanoid()
    const text = `
      INSERT INTO warehouse("id", "organizationId", "name", "countries", "createdAt", "updatedAt")
      VALUES($1, $2, $3, $4, NOW(), NOW())
      RETURNING id, "organizationId", name, countries
    `
    const values = [warehouseId, organizationId, warehouseName, JSON.stringify(countries)]
    const result = await pool.query(text, values)

    const createdWarehouse = result.rows[0]

    return NextResponse.json({ warehouse: createdWarehouse }, { status: 200 })
  } catch (error) {
    console.error("[POST /api/internal/warehouses] error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
