// src/app/api/credits/me/link-code/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getContext } from "@/lib/context";
import { redeemSyncCode } from "@/lib/credits/sync";
import { ensureWallet } from "@/lib/credits/db";

const Body = z.object({
  code: z.string().min(8),
});

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId, userId } = ctx as any;
  if (!organizationId || !userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = Body.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const res = await redeemSyncCode({ organizationId, code: parsed.data.code, userId });
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });

  await ensureWallet(organizationId, userId);

  return NextResponse.json({ linked: true });
}
