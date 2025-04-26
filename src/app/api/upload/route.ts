import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { auth } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";

export async function POST(req: NextRequest) {
  console.log("Headers received:", Object.fromEntries(req.headers.entries()));
  const apiKey = req.headers.get("x-api-key");
  const internalSecret = req.headers.get("x-internal-secret");
  let organizationId: string;

  try {
    if (apiKey) {
      const { valid, error, key } = await auth.api.verifyApiKey({ body: { key: apiKey } });
      if (!valid || !key) {
        return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 });
      }
      // For API key usage, we might need organizationId from the session or a query param
      const session = await auth.api.getSession({ headers: req.headers });
      organizationId = session?.session.activeOrganizationId || "";
      if (!organizationId) {
        return NextResponse.json(
          { error: "Organization ID required when using API key" },
          { status: 400 }
        );
      }
    } else if (internalSecret && internalSecret === process.env.INTERNAL_API_SECRET) {
      const session = await auth.api.getSession({ headers: req.headers });
      console.log("Session (internal):", session);
      if (!session) {
        return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
      }
      organizationId = session.session.activeOrganizationId;
      if (!organizationId) {
        return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
      }
    } else {
      // Fallback for UI requests using session cookie
      const session = await auth.api.getSession({ headers: req.headers });
      console.log("Session (fallback):", session);
      if (!session) {
        return NextResponse.json({ error: "Unauthorized: No session found" }, { status: 403 });
      }
      organizationId = session.session.activeOrganizationId;
      if (!organizationId) {
        return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
      }
    }

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