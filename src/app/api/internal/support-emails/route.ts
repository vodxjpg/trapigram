import { NextRequest, NextResponse } from "next/server"
import { pgPool as pool } from "@/lib/db";
import { nanoid } from "nanoid"
import { auth } from "@/lib/auth"

// nothing

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

    const { organizationId, isGlobal, country, email } = await req.json() as {
      organizationId: string
      isGlobal: boolean
      country?: string
      email: string
    }

    if (!organizationId) {
      return NextResponse.json({ error: "organizationId is required" }, { status: 400 })
    }
    if (!email) {
      return NextResponse.json({ error: "email is required" }, { status: 400 })
    }

    // We'll do a simple insert. If "isGlobal"=true, we store row with isGlobal=true, country=NULL
    const id = nanoid()
    const text = `
      INSERT INTO "organizationSupportEmail"(
        "id","organizationId","country","isGlobal","email","createdAt","updatedAt"
      )
      VALUES($1,$2,$3,$4,$5,NOW(),NOW())
      RETURNING *
    `

    // If isGlobal, we set country to null
    const finalCountry = isGlobal ? null : country || null

    const values = [id, organizationId, finalCountry, isGlobal, email]
    const result = await pool.query(text, values)
    const row = result.rows[0]

    return NextResponse.json({ success: true, record: row }, { status: 200 })
  } catch (err) {
    console.error("[POST /api/internal/support-emails] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
