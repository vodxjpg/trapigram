import RuleFormLoader from "../../components/RuleFormLoader";

export default function EditRulePage({ params }: { params: { id: string } }) {
  const { id } = params;

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Edit rule</h1>
        <p className="text-sm text-muted-foreground">Rule ID: {id}</p>
      </div>
      <RuleFormLoader id={id} />
    </div>
  );
}
