// src/app/api/payment-methods/[id]/route.ts

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";;
import { getContext } from "@/lib/context";

// nothing
// ---------------------- Zod schemas ----------------------
const paymentUpdateSchema = z.object({
  active: z.boolean(),
});

type Params = { params: { id: string } };

export async function PATCH(req: NextRequest, { params }: Params) {
 const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  try { 
    const { id } = await params;
    const { active } = await req.json();
    
    const sql = `
      UPDATE "paymentMethods"
      SET active = $1, "updatedAt" = NOW()
      WHERE id = $2
      RETURNING *
    `;

    const values = [
        active,
        id
    ]    
    const res = await pool.query(sql, values);
    if (!res.rows.length) {
      return NextResponse.json({ error: "Payment method not found" }, { status: 404 });
    }
    return NextResponse.json(res.rows[0]);
  } catch (err: any) {
    console.error("[PATCH /api/payment-methods/[id]]", err);
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
