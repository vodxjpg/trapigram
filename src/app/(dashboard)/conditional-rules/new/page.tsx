// /src/app/(dashboard)/conditional-rules/new/page.tsx
import RuleForm from "../components/RuleForm";

export default function NewRulePage() {
  return (
    <div className="p-4 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">New conditional rule</h1>
        <p className="text-sm text-muted-foreground">
          Define when it should run, who it applies to, and what it does.
        </p>
      </div>
      <RuleForm mode="create" />
    </div>
  );
}
