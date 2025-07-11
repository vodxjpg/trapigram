import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import crypto from "crypto";
import { getContext } from "@/lib/context";

const ENC_KEY_B64 = process.env.ENCRYPTION_KEY || "";
const ENC_IV_B64 = process.env.ENCRYPTION_IV || "";

function getEncryptionKeyAndIv(): { key: Buffer; iv: Buffer } {
  const key = Buffer.from(ENC_KEY_B64, "base64");
  const iv = Buffer.from(ENC_IV_B64, "base64");
  if (!ENC_KEY_B64 || !ENC_IV_B64)
    throw new Error("ENCRYPTION_KEY or ENCRYPTION_IV not set");
  if (key.length !== 32)
    throw new Error(`Invalid ENCRYPTION_KEY length: ${key.length} bytes`);
  if (iv.length !== 16)
    throw new Error(`Invalid ENCRYPTION_IV length: ${iv.length} bytes`);
  return { key, iv };
}

function encryptSecretNode(plain: string): string {
  const { key, iv } = getEncryptionKeyAndIv();
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(plain, "utf8", "base64");
  encrypted += cipher.final("base64");
  return encrypted;
}

const cartProductSchema = z.object({
  code: z.string(),
  total: z.number(),
});

/* ───────────────────────── GET (debug / lookup) ─────────────────────── */
export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const coupon = req.headers.get("coupon");
    const { rows } = await pool.query(
      `SELECT * FROM coupons
       WHERE code = $1 AND "organizationId" = $2`,
      [coupon, organizationId],
    );
    return NextResponse.json({ coupon: rows[0] }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error });
  }
}

/* ───────────────────────────── PATCH (apply) ────────────────────────── */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    /* ─── input ─────────────────────────────────────────────────────── */
    const { id } = await params;
    const body = await req.json();
    const data = cartProductSchema.parse(body);

    /* ─── coupon record ─────────────────────────────────────────────── */
    const { rows: cRows } = await pool.query(
      `SELECT * FROM "coupons"
       WHERE code = $1 AND "organizationId" = $2`,
      [data.code, organizationId],
    );
    if (cRows.length === 0)
      return NextResponse.json({ error: "Coupon not found" }, { status: 400 });
    const cup = cRows[0];

    /* ─── cart & client ─────────────────────────────────────────────── */
    const { rows: cartRows } = await pool.query(
      `SELECT * FROM carts WHERE id = $1`,
      [id],
    );
    if (cartRows.length === 0)
      return NextResponse.json({ error: "Cart not found" }, { status: 400 });
    const cart = cartRows[0];
    const cartCountry = cart.country;

    /* ─── country restriction ───────────────────────────────────────── */
    const allowed = JSON.parse(cup.countries || "[]");
    if (!allowed.includes(cartCountry))
      return NextResponse.json(
        { error: "This coupon cannot be used in your country." },
        { status: 400 },
      );

    /* ─── date window ───────────────────────────────────────────────── */
    const now = new Date();
    const start = new Date(cup.startDate);
    const end = cup.expirationDate ? new Date(cup.expirationDate) : null;
    if (now < start)
      return NextResponse.json(
        { error: "Coupon is not valid yet" },
        { status: 400 },
      );
    if (end && now > end)
      return NextResponse.json(
        { error: "Coupon is expired" },
        { status: 400 },
      );

    /* ─── per-user limit (0 ⇒ unlimited) ────────────────────────────── */
    const { rows: perUser } = await pool.query(
      `SELECT 1 FROM orders
       WHERE "clientId" = $1 AND "couponCode" = $2`,
      [cart.clientId, cup.code],
    );
    if (cup.limitPerUser > 0 && perUser.length >= cup.limitPerUser)
      return NextResponse.json(
        { error: "Coupon limit per user reached" },
        { status: 400 },
      );

    /* ─── global usage limit (0 ⇒ unlimited) ────────────────────────── */
    const { rows: usageRows } = await pool.query(
      `SELECT 1 FROM orders
       WHERE "organizationId" = $1 AND "couponCode" = $2`,
      [organizationId, cup.code],
    );
    if (cup.usageLimit > 0 && usageRows.length >= cup.usageLimit)
      return NextResponse.json(
        { error: "Coupon usage limit reached" },
        { status: 400 },
      );

    /* ─── spending window ───────────────────────────────────────────── */
    const subtotal = data.total;
    const minSpend = Number(cup.expendingMinimum) || 0;
    const maxCap = Number(cup.expendingLimit) || 0;
    if (minSpend > 0 && subtotal < minSpend)
      return NextResponse.json(
        { error: `Order total must be at least ${minSpend.toFixed(2)} €` },
        { status: 400 },
      );

    /* ─── discount calculation ──────────────────────────────────────── */
    const base = maxCap > 0 ? Math.min(subtotal, maxCap) : subtotal;
    let discountAmount = 0;

    if (cup.discountType === "percentage") {
      const rate = Number(cup.discountAmount);            // % stored as string
      discountAmount = +(base * rate / 100).toFixed(2);   // € off
    } else {
      discountAmount = Number(cup.discountAmount);        // fixed €
    }

    /* ─── persist coupon on cart ────────────────────────────────────── */
    await pool.query(
      `UPDATE carts
       SET "couponCode" = $1, "updatedAt" = NOW()
       WHERE id = $2`,
      [data.code, id],
    );

    const discount = {
      discountType: cup.discountType,            // "percentage" | "fixed"
      discountValue: Number(cup.discountAmount),  // rate (%) or fixed €
      discountAmount,
    };

    /* ─── encrypted integrity blob ─────────────────────────────────── */
    const encrypted = encryptSecretNode(JSON.stringify(discount));
    await pool.query(
      `UPDATE carts
       SET "cartUpdatedHash" = $1, "updatedAt" = NOW()
       WHERE id = $2`,
      [encrypted, id],
    );

    return NextResponse.json(discount, { status: 201 });

  } catch (err: any) {
    console.error("[PATCH /api/cart/:id/apply-coupon]", err);
    if (err instanceof z.ZodError)
      return NextResponse.json({ error: err.errors }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
