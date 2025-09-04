// src/app/(dashboard)/magic-rules/[id]/page.tsx
import { cookies, headers } from "next/headers";
import { Suspense } from "react";
import { RuleForm } from "../components/rule-form";

export const dynamic = "force-dynamic";

async function fetchRule(id: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL || "";
  // Use relative fetch on the same host with auth cookies forwarded
  const res = await fetch(`${base}/api/magic-rules/${id}`, {
    headers: {
      cookie: cookies().toString(),
      // forward important headers if needed by your auth
      "x-forwarded-host": headers().get("x-forwarded-host") || "",
      "x-forwarded-proto": headers().get("x-forwarded-proto") || "",
    },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.rule ?? null;
}

export default async function EditMagicRulePage({
  params,
}: { params: { id: string } }) {
  const rule = await fetchRule(params.id);

  if (!rule) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold">Rule not found</h1>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Edit Magic Rule</h1>
        <p className="text-muted-foreground">Update conditions and actions.</p>
      </div>
      <Suspense fallback={<div>Loading…</div>}>
        <RuleForm rule={rule} />
      </Suspense>
    </div>
  );
}
