// /src/app/api/niftipay/orders/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getContext } from "@/lib/context";

const BASE = (process.env.NIFTIPAY_API_URL || "https://www.niftipay.com").replace(/\/+$/, "");
type OrgMeta = { tenantId?: string };

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  // 1) resolve tenantId from organization.metadata
  const org = await db.selectFrom("organization")
    .select("metadata")
    .where("id", "=", ctx.organizationId)
    .executeTakeFirst();

  let tenantId: string | null = null;
  if (org?.metadata) {
    try { tenantId = (JSON.parse(org.metadata) as OrgMeta).tenantId ?? null; } catch { }
  }
  if (!tenantId) {
    return NextResponse.json({ error: "Organization tenantId not configured" }, { status: 404 });
  }

  // 2) get Niftipay apiKey for that tenant
  const pm = await db.selectFrom("paymentMethods")
    .select(["apiKey", "name"])
    .where("tenantId", "=", tenantId)
    .where("name", "=", "Niftipay")
    .executeTakeFirst();

  if (!pm?.apiKey) {
    return NextResponse.json({ error: "Niftipay not configured for tenant" }, { status: 404 });
  }

  // 3) forward payload to Niftipay
  const payload = await req.json();
  const ures = await fetch(`${BASE}/api/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": pm.apiKey,
    },
    body: JSON.stringify(payload),
  });

  const text = await ures.text();
  try {
    const json = JSON.parse(text);
    return NextResponse.json(json, { status: ures.status });
  } catch {
    return NextResponse.json(
      { error: "Bad upstream response", details: text.slice(0, 200) },
      { status: 502 }
    );
  }
}
