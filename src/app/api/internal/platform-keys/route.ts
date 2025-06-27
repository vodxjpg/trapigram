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

    const { organizationId, platform, apiKey } = await req.json() as {
      organizationId: string
      platform: string
      apiKey: string
    }

    if (!organizationId) {
      return NextResponse.json({ error: "organizationId is required" }, { status: 400 })
    }
    if (!platform) {
      return NextResponse.json({ error: "platform is required" }, { status: 400 })
    }
    if (!apiKey) {
      return NextResponse.json({ error: "apiKey is required" }, { status: 400 })
    }

    // We'll do an upsert: if there's already a row for (org, platform), update it.
    // Otherwise, insert a new row.
    // Because we have a unique constraint on ("organizationId","platform"),
    // we'll handle conflict with ON CONFLICT DO UPDATE
    const id = nanoid()
    const text = `
      INSERT INTO "organizationPlatformKey"(
        "id","organizationId","platform","apiKey","createdAt","updatedAt"
      ) 
      VALUES ($1,$2,$3,$4,NOW(),NOW())
      ON CONFLICT ("organizationId","platform") DO UPDATE
        SET "apiKey"=EXCLUDED."apiKey",
            "updatedAt"=NOW()
      RETURNING *
    `
    const values = [id, organizationId, platform, apiKey]
    const result = await pool.query(text, values)
    return NextResponse.json({ success: true, record: result.rows[0] }, { status: 200 })

  } catch (err: any) {
    console.error("[POST /api/internal/platform-keys] error:", err)

    // Handle duplicate-key on apiKey
    if (err.code === "23505" && err.constraint === "organizationPlatformKey_apiKey_key") {
      return NextResponse.json(
        { error: "This API key is already in use. Please choose a different key." },
        { status: 409 }
      )
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
