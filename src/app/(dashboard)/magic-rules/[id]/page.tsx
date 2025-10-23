// src/app/(dashboard)/magic-rules/[id]/page.tsx
import { notFound } from "next/navigation";
import { cookies, headers } from "next/headers";
import { Suspense } from "react";
import { RuleForm } from "../components/rule-form";

export const dynamic = "force-dynamic";

async function fetchRule(id: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL || "";
  const res = await fetch(`${base}/api/magic-rules/${id}`, {
    headers: {
      cookie: cookies().toString(),
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
}: {
  // ❗ Next 15 expects Promise here
  params?: Promise<{ id?: string }>;
}) {
  const p = (params ? await params : {}) as { id?: string };
  const id = p.id?.trim();
  if (!id) return notFound();

  const rule = await fetchRule(id);
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
