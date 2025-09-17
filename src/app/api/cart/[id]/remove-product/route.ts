// src/app/api/cart/[id]/remove-product/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import crypto from "crypto";
import { getContext } from "@/lib/context";
import { adjustStock } from "@/lib/stock";
import {
  tierPricing,
  getPriceForQuantity,
  type Tier,
} from "@/lib/tier-pricing";
import { resolveUnitPrice } from "@/lib/pricing";

function pickTierForClient(
  tiers: Tier[],
  country: string,
  productId: string,
  clientId?: string | null,
): Tier | null {
  const candidates = tiers.filter(
    (t) =>
      t.active === true &&
      t.countries.includes(country) &&
      t.products.some(
        (p) => p.productId === productId || p.variationId === productId,
      ),
  );
  if (!candidates.length) return null;

  const targets = (t: Tier): string[] =>
    ((((t as any).clients as string[] | undefined) ??
      ((t as any).customers as string[] | undefined) ??
      []) as string[]).filter(Boolean);

  // Prefer tier targeted to this client
  if (clientId) {
    const targeted = candidates.find((t) => targets(t).includes(clientId));
    if (targeted) return targeted;
  }
  // Otherwise only allow a global tier
  const global = candidates.find((t) => targets(t).length === 0);
  return global ?? null;
}

const ENC_KEY_B64 = process.env.ENCRYPTION_KEY || "";
const ENC_IV_B64 = process.env.ENCRYPTION_IV || "";

function getEncryptionKeyAndIv(): { key: Buffer; iv: Buffer } {
  const key = Buffer.from(ENC_KEY_B64, "base64");
  const iv = Buffer.from(ENC_IV_B64, "base64");
  if (!ENC_KEY_B64 || !ENC_IV_B64) {
    throw new Error("ENCRYPTION_KEY or ENCRYPTION_IV not set in environment");
  }
  if (key.length !== 32) {
    throw new Error(
      `Invalid ENCRYPTION_KEY: must decode to 32 bytes, got ${key.length}`,
    );
  }
  if (iv.length !== 16) {
    throw new Error(
      `Invalid ENCRYPTION_IV: must decode to 16 bytes, got ${iv.length}`,
    );
  }
  return { key, iv };
}

// Simple AES encryption using Node’s crypto library in CBC:
function encryptSecretNode(plain: string): string {
  const { key, iv } = getEncryptionKeyAndIv();
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(plain, "utf8", "base64");
  encrypted += cipher.final("base64");
  return encrypted;
}

const cartProductSchema = z.object({
  productId: z.string(),
});

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const { id } = await params;
    const body = await req.json();
    const data = cartProductSchema.parse(body);

    const delSql = `
      DELETE FROM "cartProducts" 
      WHERE "cartId" = $1 AND ( "productId" = $2 OR "affiliateProductId" = $2 )
      RETURNING *
    `;
    const vals = [id, data.productId];

    const result = await pool.query(delSql, vals);
    const deleted = result.rows[0];

    /* ---------- Affiliate refund (if needed) ---------- */
    if (deleted?.affiliateProductId) {
      const pointsToRollback = deleted.quantity * deleted.unitPrice;

      const { rows: clRows } = await pool.query(
        `SELECT "clientId" FROM carts WHERE id = $1`,
        [id],
      );
      const clientId = clRows[0]?.clientId;

      if (clientId) {
        await pool.query(
          `UPDATE "affiliatePointBalances"
             SET "pointsCurrent" = "pointsCurrent" + $1,
                 "pointsSpent"   = GREATEST("pointsSpent" - $1, 0),
                 "updatedAt"     = NOW()
           WHERE "organizationId" = $2 AND "clientId" = $3`,
          [pointsToRollback, ctx.organizationId, clientId],
        );

        await pool.query(
          `INSERT INTO "affiliatePointLogs"
             (id,"organizationId","clientId",points,action,description,"createdAt","updatedAt")
           VALUES (gen_random_uuid(),$1,$2,$3,'refund','cart line removed',NOW(),NOW())`,
          [ctx.organizationId, clientId, pointsToRollback],
        );
      }
    }

    /* country + level lookup – we need both for tier recalculation */
    const { rows: cRows } = await pool.query(
      `SELECT clients.country, clients."levelId"
         FROM clients
         JOIN carts ON carts."clientId" = clients.id
        WHERE carts.id = $1`,
      [id],
    );
    const country = cRows[0]?.country as string;
    const levelId = cRows[0]?.levelId as string;

    const { rows: clIdRows } = await pool.query(
      `SELECT "clientId" FROM carts WHERE id = $1`,
      [id],
    );
    const clientId =
      (clIdRows[0]?.clientId as string | undefined) ?? undefined;

    /* Stock release */
    const released = result.rows[0]?.quantity ?? 0;
    if (released) await adjustStock(pool, data.productId, country, +released);

    /* Hash AFTER price updates so it represents the true cart */
    const { rows: lines } = await pool.query(
      `SELECT COALESCE("productId","affiliateProductId")   AS pid,
              quantity,"unitPrice"
         FROM "cartProducts"
        WHERE "cartId" = $1`,
      [id],
    );
    const newHash = encryptSecretNode(JSON.stringify(lines));
    await pool.query(
      `UPDATE carts
          SET "cartUpdatedHash" = $1,
              "updatedAt"       = NOW()
        WHERE id = $2`,
      [newHash, id],
    );

    /* ────────────────────────────────────────────────────────────
       ▶  Tier-pricing re-evaluation after a line is removed
    ──────────────────────────────────────────────────────────── */
    if (deleted && !deleted.affiliateProductId) {
      const tiers = (await tierPricing(ctx.organizationId)) as Tier[];
      const tier = pickTierForClient(
        tiers,
        country,
        deleted.productId,
        clientId,
      );

      if (tier) {
        const tierIds = tier.products
          .map((p) => p.productId)
          .filter(Boolean) as string[];

        /* new combined quantity of *all* tier products */
        const { rows: qRows } = await pool.query(
          `SELECT COALESCE(SUM(quantity),0)::int AS qty
             FROM "cartProducts"
            WHERE "cartId" = $1
              AND "productId" = ANY($2::text[])`,
          [id, tierIds],
        );
        const qtyAfter = Number(qRows[0].qty);

        /* decide the correct unit-price for the tier */
        const newUnit = getPriceForQuantity(tier.steps, qtyAfter);

        if (newUnit === null) {
          // below first tier → fall back to each product's base price
          for (const pid of tierIds) {
            const { price } = await resolveUnitPrice(pid, country, levelId);
            await pool.query(
              `UPDATE "cartProducts"
                  SET "unitPrice" = $1,
                      "updatedAt" = NOW()
                WHERE "cartId"   = $2
                  AND "productId" = $3`,
              [price, id, pid],
            );
          }
        } else {
          // still within a tier bracket → same price for all eligible lines
          await pool.query(
            `UPDATE "cartProducts"
                SET "unitPrice" = $1,
                    "updatedAt" = NOW()
              WHERE "cartId"   = $2
                AND "productId" = ANY($3::text[])`,
            [newUnit, id, tierIds],
          );
        }
      }
    }

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (err: any) {
    console.error("[DELETE /api/cart/:id/remove-product]", err);
    if (err instanceof z.ZodError)
      return NextResponse.json({ error: err.errors }, { status: 400 });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
