import RuleForm, { RuleFormValues } from "../../components/RuleForm";

async function getRule(id: string) {
  const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/rules/${id}`, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    try {
      const b = await res.json();
      throw new Error(b?.error || "Failed to load rule");
    } catch {
      throw new Error("Failed to load rule");
    }
  }
  return (await res.json()) as any;
}

export default async function EditRulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const rule = await getRule(id);

  const defaults: Partial<RuleFormValues> = {
    name: rule.name,
    description: rule.description,
    enabled: rule.enabled,
    priority: rule.priority ?? 100,
    event: rule.event,
    countries: rule.countries ?? [],
    orderCurrencyIn: rule.orderCurrencyIn ?? [],
    action: rule.action,
    channels: rule.channels ?? [],
    payload: rule.payload ?? {},
  };

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Edit rule</h1>
        <p className="text-sm text-muted-foreground">Rule ID: {id}</p>
      </div>
      <RuleForm mode="edit" id={id} defaultValues={defaults} />
    </div>
  );
}
