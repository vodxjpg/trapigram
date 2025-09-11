import RuleForm from "../../components/RuleForm";

async function getRule(id: string) {
  const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/rules/${id}`, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error("Failed to load rule");
  return res.json();
}

export default async function EditRulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rule = await getRule(id);

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Edit rule</h1>
        <p className="text-sm text-muted-foreground">Rule ID: {id}</p>
      </div>
      <RuleForm
        mode="edit"
        id={id}
        defaultValues={{
          name: rule.name,
          description: rule.description,
          enabled: rule.enabled,
          priority: rule.priority ?? 100,
          countries: rule.countries ?? [],
          orderCurrencyIn: rule.orderCurrencyIn ?? [],
          events: [rule.event], // single for edit
          onlyIfProductIdsAny: rule.payload?.onlyIfProductIdsAny ?? [],
        }}
        existingSingle={{
          event: rule.event,
          action: rule.action,
          channels: rule.channels,
          payload: rule.payload ?? {},
        }}
      />
    </div>
  );
}
