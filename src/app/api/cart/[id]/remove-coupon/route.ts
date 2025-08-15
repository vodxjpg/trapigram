import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  try {
    const { id } = await params;
    await pool.query(
      `UPDATE carts
         SET "couponCode" = NULL,
             "cartUpdatedHash" = NULL,
             "updatedAt" = NOW()
       WHERE id = $1`,
      [id],
    );
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    console.error("[DELETE /api/cart/:id/remove-coupon]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
