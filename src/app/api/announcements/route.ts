// /home/zodx/Desktop/Trapyfy/src/app/api/announcements/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";;
import { v4 as uuidv4 } from "uuid";
import purify from "@/lib/dompurify";
import { getContext } from "@/lib/context";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});


const announcementSchema = z.object({
  title: z.string().min(1, { message: "Title is required." }),
  content: z.string().min(1, { message: "Content is required." }),
  deliveryDate: z.string().nullable().optional(),
  countries: z.string().min(1, { message: "Countries is required." }),
  sent: z.boolean().default(false),
});

export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  const { searchParams } = new URL(req.url);
  const page = Number(searchParams.get("page")) || 1;
  const pageSize = Number(searchParams.get("pageSize")) || 10;
  const search = searchParams.get("search") || "";

  let countQuery = `
    SELECT COUNT(*) FROM announcements
    WHERE "organizationId" = $1
  `;
  const countValues: any[] = [organizationId];
  if (search) {
    countQuery += ` AND (title ILIKE $2 OR content ILIKE $2)`;
    countValues.push(`%${search}%`);
  }

  let query = `
    SELECT id, "organizationId", title, content, "deliveryDate", countries, sent, "createdAt", "updatedAt"
    FROM announcements
    WHERE "organizationId" = $1
  `;
  const values: any[] = [organizationId];
  if (search) {
    query += ` AND (title ILIKE $2 OR content ILIKE $2)`;
    values.push(`%${search}%`);
  }
  query += ` ORDER BY "createdAt" DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
  values.push(pageSize, (page - 1) * pageSize);

  try {
    const countResult = await pool.query(countQuery, countValues);
    const totalRows = Number(countResult.rows[0].count);
    const totalPages = Math.ceil(totalRows / pageSize);

    const result = await pool.query(query, values);
    const announcements = result.rows.map((announcement) => ({
      ...announcement,
      countries: JSON.parse(announcement.countries), // Parse JSON string to array
    }));

    return NextResponse.json({
      announcements,
      totalPages,
      currentPage: page,
    });
  } catch (error: any) {
    console.error("[GET /api/announcements] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const body = await req.json();
    const parsedAnnouncement = announcementSchema.parse(body);
    const sanitizedContent = purify.sanitize(parsedAnnouncement.content);
    const announcementId = uuidv4();

    const insertQuery = `
      INSERT INTO announcements(id, "organizationId", title, content, "deliveryDate", countries, sent, "createdAt", "updatedAt")
      VALUES($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      RETURNING *
    `;
    const values = [
      announcementId,
      organizationId,
      parsedAnnouncement.title,
      sanitizedContent,
      parsedAnnouncement.deliveryDate || null,
      parsedAnnouncement.countries,
      parsedAnnouncement.sent || false,
    ];

    const result = await pool.query(insertQuery, values);
    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error: any) {
    console.error("[POST /api/announcements] error:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}