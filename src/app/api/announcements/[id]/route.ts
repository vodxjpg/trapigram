// /home/zodx/Desktop/Trapyfy/src/app/api/announcements/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";;
import purify from "@/lib/dompurify";
import { getContext } from "@/lib/context";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const announcementUpdateSchema = z.object({
  title: z.string().min(1, { message: "Title is required." }).optional(),
  content: z.string().min(1, { message: "Content is required." }).optional(),
  deliveryDate: z.string().nullable().optional(),
  countries: z.string().optional(),
  sent: z.boolean().optional(),
});

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const { id } = params;
    const query = `
      SELECT id, "organizationId", title, content, "deliveryDate", countries, sent, "createdAt", "updatedAt"
      FROM announcements
      WHERE id = $1 AND "organizationId" = $2
    `;
    const result = await pool.query(query, [id, organizationId]);
    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Announcement not found" }, { status: 404 });
    }
    const announcement = result.rows[0];
    announcement.countries = JSON.parse(announcement.countries); // Parse JSON string to array
    return NextResponse.json(announcement);
  } catch (error: any) {
    console.error("[GET /api/announcements/[id]] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const { id } = params;
    const body = await req.json();
    const parsedAnnouncement = announcementUpdateSchema.parse(body);

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(parsedAnnouncement)) {
      if (value !== undefined) {
        if (key === "content") {
          updates.push(`"${key}" = $${paramIndex++}`);
          values.push(purify.sanitize(value as string)); // Use configured purify
        } else {
          updates.push(`"${key}" = $${paramIndex++}`);
          values.push(value);
        }
      }
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: "No fields provided to update" }, { status: 400 });
    }

    values.push(id, organizationId);
    const query = `
      UPDATE announcements
      SET ${updates.join(", ")}, "updatedAt" = NOW()
      WHERE id = $${paramIndex++} AND "organizationId" = $${paramIndex}
      RETURNING *
    `;

    const result = await pool.query(query, values);
    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Announcement not found" }, { status: 404 });
    }
    return NextResponse.json(result.rows[0]);
  } catch (error: any) {
    console.error("[PATCH /api/announcements/[id]] error:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const { id } = params;
    const query = `
      DELETE FROM announcements
      WHERE id = $1 AND "organizationId" = $2
      RETURNING *
    `;
    const result = await pool.query(query, [id, organizationId]);
    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Announcement not found" }, { status: 404 });
    }
    return NextResponse.json({ message: "Announcement deleted successfully" });
  } catch (error: any) {
    console.error("[DELETE /api/announcements/[id]] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}