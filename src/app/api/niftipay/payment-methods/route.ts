// /api/niftipay/payment-methods/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getContext } from "@/lib/context";

const BASE = (process.env.NIFTIPAY_API_URL || "https://www.niftipay.com").replace(/\/+$/,"");

type OrgMeta = { tenantId?: string } & Record<string, unknown>;

export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  // 1) get tenantId from organization.metadata
  const org = await db
    .selectFrom("organization")
    .select("metadata")
    .where("id", "=", ctx.organizationId)
    .executeTakeFirst();

  let tenantId: string | null = null;
  if (org?.metadata) {
    try {
      const meta = JSON.parse(org.metadata) as OrgMeta;
      tenantId = typeof meta.tenantId === "string" ? meta.tenantId : null;
    } catch {
      /* ignore parse error */
    }
  }
  if (!tenantId) {
    return NextResponse.json(
      { error: "Organization tenantId not configured" },
      { status: 404 }
    );
  }

  // optional: allow selecting a specific PM id, but still enforce same tenant
  const pmId = new URL(req.url).searchParams.get("paymentMethodId") ?? null;

  const pm = pmId
    ? await db
        .selectFrom("paymentMethods")
        .select(["apiKey", "name"])
        .where("id", "=", pmId)
        .where("tenantId", "=", tenantId)
        .executeTakeFirst()
    : await db
        .selectFrom("paymentMethods")
        .select(["apiKey", "name"])
        .where("tenantId", "=", tenantId)
        .where("name", "=", "Niftipay")
        .executeTakeFirst();

  if (!pm?.apiKey) {
    return NextResponse.json(
      { error: "Niftipay not configured for tenant" },
      { status: 404 }
    );
  }

  // 3) call upstream (try correct endpoint, then legacy typo)
  const endpoints = [
    `${BASE}/api/payment-methods`,
    `${BASE}/api/payment-emthods`,
  ];

  for (const url of endpoints) {
    const ures = await fetch(url, { headers: { "x-api-key": pm.apiKey } });
    const text = await ures.text();
    try {
      const json = JSON.parse(text);
      return NextResponse.json(json, { status: ures.status });
    } catch {
      if (ures.status !== 404) {
        return NextResponse.json(
          { error: "Bad upstream response", details: text.slice(0, 200) },
          { status: 502 }
        );
      }
      // 404 → try next endpoint
    }
  }

  return NextResponse.json(
    { error: "Upstream endpoint not found" },
    { status: 502 }
  );
}
