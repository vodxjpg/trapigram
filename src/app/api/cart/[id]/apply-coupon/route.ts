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

/* Helpers for discount computation */
type CouponRow = {
  code: string;
  countries: string | null;
  startDate: string;
  expirationDate: string | null;
  limitPerUser: number | null;
  usageLimit: number | null;
  expendingMinimum: number | null;
  expendingLimit: number | null;
  discountType: "percentage" | "fixed";
  discountAmount: string | number;
  stackable?: boolean | null;
};

function parseCountries(countries: string | null): string[] {
  try {
    return countries ? JSON.parse(countries) : [];
  } catch {
    return [];
  }
}

function computeOneDiscount(
  coupon: CouponRow,
  currentSubtotal: number
) {
  const minSpend = Number(coupon.expendingMinimum || 0);
  const maxCap = Number(coupon.expendingLimit || 0);

  if (minSpend > 0 && currentSubtotal < minSpend) {
    return {
      discountAmount: 0,
      calculationBase: Math.min(currentSubtotal, maxCap > 0 ? maxCap : currentSubtotal),
      minSpend,
      maxCap,
    };
  }

  const base =
    maxCap > 0 ? Math.min(currentSubtotal, maxCap) : currentSubtotal;

  let discountAmount = 0;
  if (coupon.discountType === "percentage") {
    const rate = Number(coupon.discountAmount);
    discountAmount = +(base * rate / 100).toFixed(2);
  } else {
    discountAmount = Number(coupon.discountAmount);
  }

  // Never subtract more than current subtotal
  discountAmount = Math.min(discountAmount, currentSubtotal);

  return {
    discountAmount,
    calculationBase: base,
    minSpend,
    maxCap,
  };
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

    /* ─── coupon record (new) ───────────────────────────────────────── */
    const { rows: cRows } = await pool.query(
      `SELECT * FROM "coupons"
       WHERE code = $1 AND "organizationId" = $2`,
      [data.code, organizationId],
    );
    if (cRows.length === 0)
      return NextResponse.json({ error: "Coupon not found" }, { status: 400 });
    const cup: CouponRow = cRows[0] as any;

    /* ─── cart ──────────────────────────────────────────────────────── */
    const { rows: cartRows } = await pool.query(
      `SELECT * FROM carts WHERE id = $1`,
      [id],
    );
    if (cartRows.length === 0)
      return NextResponse.json({ error: "Cart not found" }, { status: 400 });
    const cart = cartRows[0];
    const cartCountry: string = cart.country;

    /* ─── country restriction (new coupon) ──────────────────────────── */
    const allowedNew = parseCountries(cup.countries);
    if (!allowedNew.includes(cartCountry))
      return NextResponse.json(
        {
          error: "This coupon cannot be used in your country.",
          errorCode: "COUPON_COUNTRY_FORBIDDEN",
          countries: allowedNew,
        },
        { status: 400 },
      );

    /* ─── date window (new coupon) ──────────────────────────────────── */
    const now = new Date();
    const start = new Date(cup.startDate);
    const end = cup.expirationDate ? new Date(cup.expirationDate) : null;
    if (now < start)
      return NextResponse.json(
        {
          error: "Coupon is not valid yet",
          errorCode: "COUPON_NOT_YET_VALID",
          startDate: cup.startDate,
        },
        { status: 400 },
      );
    if (end && now > end)
      return NextResponse.json(
        {
          error: "Coupon is expired",
          errorCode: "COUPON_EXPIRED",
          expirationDate: cup.expirationDate,
        },
        { status: 400 },
      );

    /* ─── per-user limit (new coupon) ───────────────────────────────── */
    const { rows: perUser } = await pool.query(
      `SELECT 1 FROM orders
       WHERE "clientId" = $1 AND "couponCode" = $2`,
      [cart.clientId, cup.code],
    );
    if ((cup.limitPerUser ?? 0) > 0 && perUser.length >= Number(cup.limitPerUser))
      return NextResponse.json(
        {
          error: "Coupon limit per user reached",
          errorCode: "COUPON_LIMIT_PER_USER",
          limitPerUser: cup.limitPerUser,
        },
        { status: 400 },
      );

    /* ─── global usage limit (new coupon) ───────────────────────────── */
    const { rows: usageRows } = await pool.query(
      `SELECT 1 FROM orders
       WHERE "organizationId" = $1 AND "couponCode" = $2`,
      [organizationId, cup.code],
    );
    if ((cup.usageLimit ?? 0) > 0 && usageRows.length >= Number(cup.usageLimit))
      return NextResponse.json(
        {
          error: "Coupon usage limit reached",
          errorCode: "COUPON_USAGE_LIMIT",
          usageLimit: cup.usageLimit,
        },
        { status: 400 },
      );

    /* ─── start from passed total ───────────────────────────────────── */
    const initialTotal = data.total;

    /* ─── previously-applied coupons (comma-separated) ──────────────── */
    const existingCodesRaw: string | null = cart.couponCode || null;
    const existingCodes: string[] = existingCodesRaw
      ? existingCodesRaw.split(",").map((s: string) => s.trim()).filter(Boolean)
      : [];

    // Avoid duplicates
    if (existingCodes.includes(data.code)) {
      return NextResponse.json(
        { error: "Coupon already applied", errorCode: "COUPON_DUPLICATE" },
        { status: 400 },
      );
    }

    /* ─── load existing coupon rows in the same order ───────────────── */
    let existingCoupons: CouponRow[] = [];
    if (existingCodes.length > 0) {
      const placeholders = existingCodes.map((_, i) => `$${i + 1}`).join(",");
      const { rows: prevRows } = await pool.query(
        `SELECT * FROM "coupons"
         WHERE code IN (${placeholders}) AND "organizationId" = $${existingCodes.length + 1}`,
        [...existingCodes, organizationId],
      );
      // preserve order as in cart.couponCode
      const map = new Map(prevRows.map((r: any) => [r.code, r]));
      existingCoupons = existingCodes
        .map((code) => map.get(code))
        .filter(Boolean) as any[];
    }

    /* ─── stacking rules ────────────────────────────────────────────── */
    const anyPrevNonStackable = existingCoupons.some((c) => !c.stackable);
    if (anyPrevNonStackable) {
      return NextResponse.json(
        {
          error: "An existing coupon is non-stackable; you cannot add another.",
          errorCode: "COUPON_NON_STACKABLE_PRESENT",
        },
        { status: 400 },
      );
    }
    if (existingCoupons.length > 0 && !cup.stackable) {
      return NextResponse.json(
        {
          error: "This coupon is non-stackable and another coupon is already applied.",
          errorCode: "COUPON_NEW_NON_STACKABLE",
        },
        { status: 400 },
      );
    }

    /* ─── recompute sequential discounts (previous, then new) ───────── */
    let runningSubtotal = initialTotal;
    const applied: {
      code: string;
      discountType: "percentage" | "fixed";
      discountValue: number;
      discountAmount: number;
      calculationBase: number;
      minSpend: number;
      maxCap: number;
      subtotalAfter: number;
    }[] = [];

    // country/date checks for previous coupons (defensive)
    for (const prev of existingCoupons) {
      const allowed = parseCountries(prev.countries);
      if (!allowed.includes(cartCountry)) continue; // skip if now forbidden
      const prevStart = new Date(prev.startDate);
      const prevEnd = prev.expirationDate ? new Date(prev.expirationDate) : null;
      if (now < prevStart) continue;
      if (prevEnd && now > prevEnd) continue;

      const res = computeOneDiscount(prev, runningSubtotal);
      const discountAmount = res.discountAmount;

      runningSubtotal = +(Math.max(0, runningSubtotal - discountAmount)).toFixed(2);

      applied.push({
        code: (prev as any).code,
        discountType: prev.discountType,
        discountValue: Number(prev.discountAmount),
        discountAmount,
        calculationBase: res.calculationBase,
        minSpend: res.minSpend,
        maxCap: res.maxCap,
        subtotalAfter: runningSubtotal,
      });
    }

    // Now compute for the NEW coupon on the updated subtotal
    const allowedNow = parseCountries(cup.countries);
    if (!allowedNow.includes(cartCountry))
      return NextResponse.json(
        {
          error: "This coupon cannot be used in your country.",
          errorCode: "COUPON_COUNTRY_FORBIDDEN",
          countries: allowedNow,
        },
        { status: 400 },
      );

    const resNew = computeOneDiscount(cup, runningSubtotal);

    // If minSpend for the new coupon is not reached against running subtotal, block
    if (resNew.minSpend > 0 && runningSubtotal < resNew.minSpend) {
      return NextResponse.json(
        {
          error: `Order total must be at least ${resNew.minSpend.toFixed(2)} €`,
          errorCode: "COUPON_MIN_SPEND",
          minSpend: resNew.minSpend,
          subtotal: runningSubtotal,
        },
        { status: 400 },
      );
    }

    const newDiscountAmount = resNew.discountAmount;
    runningSubtotal = +(Math.max(0, runningSubtotal - newDiscountAmount)).toFixed(2);

    applied.push({
      code: (cup as any).code,
      discountType: cup.discountType,
      discountValue: Number(cup.discountAmount),
      discountAmount: newDiscountAmount,
      calculationBase: resNew.calculationBase,
      minSpend: resNew.minSpend,
      maxCap: resNew.maxCap,
      subtotalAfter: runningSubtotal,
    });

    /* ─── persist coupon codes on cart (comma-separated) ────────────── */
    const finalCodes = [...existingCodes, data.code].join(",");
    await pool.query(
      `UPDATE carts
       SET "couponCode" = $1, "updatedAt" = NOW()
       WHERE id = $2`,
      [finalCodes, id],
    );

    /* ─── build response (keeps previous shape; adds extras) ────────── */
    const discountResponse = {
      // legacy fields for the newly-applied coupon
      discountType: cup.discountType,
      discountValue: Number(cup.discountAmount),
      discountAmount: newDiscountAmount,
      calculationBase: resNew.calculationBase,
      minSpend: resNew.minSpend,
      maxCap: resNew.maxCap,
      // new helpful fields
      appliedCodes: finalCodes,
      cumulativeDiscount: applied.reduce((s, d) => s + d.discountAmount, 0),
      newSubtotal: runningSubtotal,
      breakdown: applied, // sequential detail (prev + new)
    };

    /* ─── encrypted integrity blob (all applied discounts) ──────────── */
    const encrypted = encryptSecretNode(JSON.stringify(discountResponse));
    await pool.query(
      `UPDATE carts
       SET "cartUpdatedHash" = $1, "updatedAt" = NOW()
       WHERE id = $2`,
      [encrypted, id],
    );

    return NextResponse.json(discountResponse, { status: 201 });

  } catch (err: any) {
    console.error("[PATCH /api/cart/:id/apply-coupon]", err);
    if (err instanceof z.ZodError)
      return NextResponse.json({ error: err.errors }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
