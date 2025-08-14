// src/app/api/clients/resolve/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

const qpSchema = z.object({
  userId: z.string().optional(),
  username: z.string().optional(),
  email: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
});

function norm(v?: string) {
  if (v === undefined || v === null) return undefined;
  const s = v.trim();
  return s.length ? s : undefined;
}

export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  const raw = Object.fromEntries(new URL(req.url).searchParams.entries());
  const qp = qpSchema.parse(raw);

  // Normalize empties and whitespace
  const userId   = norm(qp.userId);
  const username = norm(qp.username);
  const email    = norm(qp.email);
  const first    = norm(qp.firstName);
  const last     = norm(qp.lastName);

  const parts: string[] = [`"organizationId" = $1`];
  const vals: any[] = [organizationId];
  let i = 2;

  // Strong keys: exact (username/email case-insensitive)
  if (userId)   { parts.push(`"userId" = $${i++}`); vals.push(userId); }
  if (username) { parts.push(`LOWER(BTRIM(username)) = LOWER(BTRIM($${i++}))`); vals.push(username); }
  if (email)    { parts.push(`LOWER(BTRIM(email)) = LOWER(BTRIM($${i++}))`);    vals.push(email); }

  // Names: exact, but case-insensitive + trimmed to avoid false negatives
  if (first)    { parts.push(`LOWER(BTRIM("firstName")) = LOWER(BTRIM($${i++}))`); vals.push(first); }
  if (last)     { parts.push(`LOWER(BTRIM("lastName"))  = LOWER(BTRIM($${i++}))`); vals.push(last); }

  if (parts.length === 1) {
    return NextResponse.json({ error: "Provide at least one query param to resolve." }, { status: 400 });
  }

  // All provided constraints must match (AND)
  const where = parts.slice(1).join(" AND ");
  const { rows } = await pool.query(
    `
    SELECT id,"userId",username,"firstName","lastName",email,"phoneNumber","createdAt"
    FROM clients
    WHERE ${parts[0]} AND ${where}
    `,
    vals,
  );

  if (rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (rows.length > 1)  return NextResponse.json({ error: "Ambiguous", matches: rows.slice(0, 10) }, { status: 409 });
  return NextResponse.json({ client: rows[0] }, { status: 200 });
}
