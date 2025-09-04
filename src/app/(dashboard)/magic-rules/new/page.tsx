// src/app/(dashboard)/magic-rules/new/page.tsx
import { Suspense } from "react";
import { RuleForm } from "../components/rule-form";

export const dynamic = "force-dynamic";

export default function NewMagicRulePage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">New Magic Rule</h1>
        <p className="text-muted-foreground">Define conditions and actions.</p>
      </div>
      <Suspense fallback={<div>Loading…</div>}>
        <RuleForm />
      </Suspense>
    </div>
  );
}
