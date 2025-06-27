/* /src/app/api/internal/tenant/route.ts
   Handles creation & retrieval of the current user’s tenant (workspace)
   ─────────────────────────────────────────────────────────────────── */

   import { NextRequest, NextResponse } from "next/server"
   import { pgPool as pool } from "@/lib/db";
   import { auth } from "@/lib/auth"
   
   
   const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || "your-secret-here"
   
   /* ───────────────────────── POST /api/internal/tenant ─────────────────────────
      Creates one tenant for the current user. A user may only have ONE tenant.
      Request JSON: { plan: "free" | "pro" | "enterprise" }
      Headers:      x-internal-secret
   ────────────────────────────────────────────────────────────────────────────── */
   export async function POST(req: NextRequest) {
     try {
       /* 1. Internal secret check ------------------------------------------------ */
       const secret = req.headers.get("x-internal-secret")
       if (secret !== INTERNAL_API_SECRET) {
         return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
       }
   
       /* 2. Auth session --------------------------------------------------------- */
       const session = await auth.api.getSession({ headers: req.headers })
       if (!session) {
         return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
       }
       const user = session.user
   
       /* 3. Body validation ------------------------------------------------------ */
       const { plan } = (await req.json()) as { plan?: string }
       if (!plan) {
         return NextResponse.json({ error: "plan is required" }, { status: 400 })
       }
   
       /* 4. Enforce 1-tenant-per-user ------------------------------------------- */
       const existing = await pool.query(
         `SELECT id FROM tenant WHERE "ownerUserId" = $1`,
         [user.id],
       )
       if (existing.rows.length) {
         return NextResponse.json({ error: "Tenant already exists" }, { status: 400 })
       }
   
       /* 5. Create tenant -------------------------------------------------------- */
       const insert = await pool.query(
         `INSERT INTO tenant(
            id, "ownerUserId", plan, "ownerName", "ownerEmail",
            "createdAt", "updatedAt", "onboardingCompleted"
          )
          VALUES (
            gen_random_uuid()::text, $1, $2, $3, $4,
            NOW(), NOW(), 0
          )
          RETURNING id, "ownerUserId", plan, "ownerName", "ownerEmail",
                    "createdAt", "updatedAt", "onboardingCompleted"`,
         [user.id, plan, user.name, user.email],
       )
   
       return NextResponse.json({ tenant: insert.rows[0] }, { status: 201 })
     } catch (error) {
       console.error("[POST /api/internal/tenant] error:", error)
       return NextResponse.json({ error: "Internal server error" }, { status: 500 })
     }
   }
   
   /* ───────────────────────── GET /api/internal/tenant ─────────────────────────
      Returns the tenant that belongs to the current user.
   ────────────────────────────────────────────────────────────────────────────── */
   export async function GET(req: NextRequest) {
     try {
       /* 1. Internal secret check ------------------------------------------------ */
       const secret = req.headers.get("x-internal-secret")
       if (secret !== INTERNAL_API_SECRET) {
         return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
       }
   
       /* 2. Auth session --------------------------------------------------------- */
       const session = await auth.api.getSession({ headers: req.headers })
       if (!session) {
         return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
       }
       const user = session.user
   
       /* 3. Fetch tenant --------------------------------------------------------- */
       const result = await pool.query(
         `SELECT id, "ownerUserId", plan, "ownerName", "ownerEmail",
                 "createdAt", "updatedAt", "onboardingCompleted"
          FROM tenant
          WHERE "ownerUserId" = $1`,
         [user.id],
       )
   
       if (!result.rows.length) {
         return NextResponse.json({ error: "No tenant found" }, { status: 404 })
       }
   
       return NextResponse.json({ tenant: result.rows[0] }, { status: 200 })
     } catch (error) {
       console.error("[GET /api/internal/tenant] error:", error)
       return NextResponse.json({ error: "Internal server error" }, { status: 500 })
     }
   }
   