import { pgPool as pool } from "@/lib/db";
import { publishDisplayEvent, type DisplayEvent } from "@/lib/customer-display-bus";

/** parse registerId from channel: "pos-<storeId>-<registerId>" */
function parseRegisterIdFromChannel(channel: string | null): string | null {
  if (!channel) return null;
  const m = /^pos-[^-]+-([^-]+)$/i.exec(channel);
  return m ? m[1] : null;
}

export async function emitCartToDisplay(cartId: string) {
  // cart + channel
  const { rows: crows } = await pool.query(
    `SELECT id, channel
       FROM carts
      WHERE id = $1
      LIMIT 1`,
    [cartId]
  );
  if (!crows.length) return;
  const channel = (crows[0].channel ?? "") as string;
  if (!channel.toLowerCase().startsWith("pos-")) return; // only POS carts drive the display

  // resolve target register + current session
  const registerId = parseRegisterIdFromChannel(channel);
  if (!registerId) return;
  const { rows: rrows } = await pool.query(
    `SELECT "displaySessionId" FROM registers WHERE id = $1 LIMIT 1`,
    [registerId]
  );
  const sessionId: string | null = rrows[0]?.displaySessionId ?? null;
  if (!sessionId) return; // not paired

  // build lines
  const { rows: lines } = await pool.query(
    `
      SELECT
        COALESCE(p.title, ap.title) AS title,
        COALESCE(p.image, ap.image) AS image,
        COALESCE(p.sku,   ap.sku)   AS sku,
        cp.quantity,
        cp."unitPrice" AS "unitPrice",
        (cp.quantity * cp."unitPrice")::numeric AS subtotal
      FROM "cartProducts" cp
      LEFT JOIN products p             ON p.id  = cp."productId"
      LEFT JOIN "affiliateProducts" ap ON ap.id = cp."affiliateProductId"
     WHERE cp."cartId" = $1
     ORDER BY cp."createdAt" ASC
    `,
    [cartId]
  );

  const subtotal = Number(lines.reduce((s: number, l: any) => s + Number(l.subtotal || 0), 0));
  const discount = 0; // (plug real cart discount here if you persist it per-cart)
  const shipping = 0;
  const total = +(subtotal - discount + shipping).toFixed(2);

  const ev: DisplayEvent = {
    type: "cart",
    cartId,
    lines: lines.map((l: any) => ({
      title: l.title,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      sku: l.sku ?? null,
      subtotal: Number(l.subtotal),
      image: l.image ?? null,
    })),
    subtotal,
    discount,
    shipping,
    total,
  };

  await publishDisplayEvent(registerId, sessionId, ev);
}

export async function emitIdleForCart(cartId: string) {
  const { rows: crows } = await pool.query(
    `SELECT channel FROM carts WHERE id = $1 LIMIT 1`,
    [cartId]
  );
  if (!crows.length) return;
  const channel = (crows[0].channel ?? "") as string;
  if (!channel.toLowerCase().startsWith("pos-")) return;

  const registerId = parseRegisterIdFromChannel(channel);
  if (!registerId) return;
  const { rows: rrows } = await pool.query(
    `SELECT "displaySessionId" FROM registers WHERE id = $1 LIMIT 1`,
    [registerId]
  );
  const sessionId: string | null = rrows[0]?.displaySessionId ?? null;
  if (!sessionId) return;

  await publishDisplayEvent(registerId, sessionId, { type: "idle" });
}
