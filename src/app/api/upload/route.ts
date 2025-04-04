// /home/zodx/Desktop/trapigram/src/app/api/upload/route.ts

import { NextRequest, NextResponse } from "next/server"
import { writeFile, mkdir } from "fs/promises"
import { join, dirname } from "path"
import { auth } from "@/lib/auth"
import { v4 as uuidv4 } from "uuid"

// API key for public endpoints (assuming public; adjust if internal)
const PUBLIC_API_KEY = process.env.PUBLIC_API_KEY as string

export async function POST(req: NextRequest) {
  try {
    // Check API key for public access
    const apiKey = req.headers.get("x-api-key")
    if (apiKey !== PUBLIC_API_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    // Check session
    const session = await auth.api.getSession({ headers: req.headers })
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Note: Original code used session.user.activeOrganizationId, but based on prior fixes, it should be session.session.activeOrganizationId
    const organizationId = session.session.activeOrganizationId
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization" }, { status: 400 })
    }

    const formData = await req.formData()
    const file = formData.get("file") as File

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 })
    }

    // Validate file type
    const validTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"]
    if (!validTypes.includes(file.type)) {
      return NextResponse.json({ error: "Invalid file type" }, { status: 400 })
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large (max 5MB)" }, { status: 400 })
    }

    // Create unique filename
    const fileExt = file.name.split(".").pop()
    const fileName = `${uuidv4()}.${fileExt}`

    // Create tenant directory path
    const uploadDir = join(process.cwd(), "public", "uploads", "tenants", organizationId, "categories")

    // Ensure directory exists
    await mkdir(dirname(join(uploadDir, fileName)), { recursive: true })

    // Convert file to buffer and save
    const buffer = Buffer.from(await file.arrayBuffer())
    await writeFile(join(uploadDir, fileName), buffer)

    // Return the path to the file (relative to public directory)
    const filePath = `/uploads/tenants/${organizationId}/categories/${fileName}`

    return NextResponse.json({
      success: true,
      filePath,
    }, { status: 200 })
  } catch (error) {
    console.error("[POST /api/upload] error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}