// /src/app/(dashboard)/conditional-rules/edit/[id]/page.tsx
import { notFound } from "next/navigation";
import RuleFormLoader from "../../components/RuleFormLoader";

export default async function EditRulePage({
  params,
}: {
  params?: Promise<{ id?: string }>;
}) {
  const p = (params ? await params : {}) as { id?: string };
  const id = p.id?.trim();
  if (!id) return notFound();

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Edit rule</h1>
      </div>
      <RuleFormLoader id={id} />
    </div>
  );
}
