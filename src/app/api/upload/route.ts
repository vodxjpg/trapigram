// src/app/api/upload/route.ts  ← UPDATED
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { getContext } from "@/lib/context";

/* helper: decide storage backend */
const useBlob = !!process.env.VERCEL_BLOB_READ_WRITE_TOKEN_READ_WRITE_TOKEN;

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    if (!file)
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

    /* ---------- validation ---------- */
    const img = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    const vid = [
      "video/mp4",
      "video/webm",
      "video/ogg",
      "video/quicktime",
      "video/x-msvideo",
      "video/mpeg",
    ];
    const okTypes = [...img, ...vid];
    if (!okTypes.includes(file.type))
      return NextResponse.json({ error: "Invalid file type" }, { status: 400 });

    const max = img.includes(file.type) ? 5 * 2 ** 20 : 150 * 2 ** 20;
    if (file.size > max) {
      const lbl = img.includes(file.type) ? "5MB" : "150MB";
      return NextResponse.json({ error: `File too large (max ${lbl})` }, { status: 400 });
    }

    /* ---------- naming & buffer ---------- */
    const ext  = file.name.split(".").pop();
    const name = `${uuidv4()}.${ext}`;
    const path = `tenants/${organizationId}/categories/${name}`;
    const buf  = Buffer.from(await file.arrayBuffer());

    /* ---------- storage ---------- */
    let url: string;
    if (useBlob) {
      // dynamic import keeps local dev working even if @vercel/blob isn't installed
      // eslint-disable-next-line @typescript-eslint/consistent-type-imports
      const { put } = (await import("@vercel/blob")) as typeof import("@vercel/blob");
      ({ url } = await put(path, buf, { access: "public", contentType: file.type }));
    } else {
      const absDir = join(process.cwd(), "public", "uploads", path.split("/").slice(0, -1).join("/"));
      await mkdir(absDir, { recursive: true });
      await writeFile(join(process.cwd(), "public", "uploads", path), buf);
      url = `/uploads/${path}`;              // served statically in dev
    }

    return NextResponse.json({ success: true, filePath: url }, { status: 200 });
  } catch (err) {
    console.error("[POST /api/upload] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
