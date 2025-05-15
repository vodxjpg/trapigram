import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { auth } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context"

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    // Validate file type
    const validTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!validTypes.includes(file.type)) {
      return NextResponse.json({ error: "Invalid file type" }, { status: 400 });
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large (max 5MB)" }, { status: 400 });
    }

    // Create unique filename
    const fileExt = file.name.split(".").pop();
    const fileName = `${uuidv4()}.${fileExt}`;

    // Create tenant directory path
    const uploadDir = join(process.cwd(), "public", "uploads", "tenants", organizationId, "categories");

    // Ensure directory exists
    await mkdir(dirname(join(uploadDir, fileName)), { recursive: true });

    // Convert file to buffer and save
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(join(uploadDir, fileName), buffer);

    // Return the path to the file (relative to public directory)
    const filePath = `/uploads/tenants/${organizationId}/categories/${fileName}`;

    return NextResponse.json({
      success: true,
      filePath,
    }, { status: 200 });
  } catch (error) {
    console.error("[POST /api/upload] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}