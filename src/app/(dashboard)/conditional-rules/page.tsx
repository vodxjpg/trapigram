import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type RuleRow = {
  id: string;
  name: string;
  event: string;
  enabled: boolean;
  countries: string[];
  orderCurrencyIn: string[];
  action: "send_coupon" | "product_recommendation" | "multi";
  channels: ("email" | "telegram" | "in_app" | "webhook")[];
  payload: any;
  priority: number;
  updatedAt?: string;
};

async function getRules(): Promise<RuleRow[]> {
  const res = await fetch(`/api/rules`, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!res.ok) return [];
  const body = await res.json().catch(() => ({ rules: [] }));
  return body.rules ?? [];
}

/** Server Action: toggle enabled */
async function toggleEnabled(id: string, enabled: boolean) {
  "use server";
 await fetch(`/api/rules/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
}

/** Server Action: delete rule */
async function removeRule(id: string) {
  "use server";
   await fetch(`/api/rules/${id}`, {
    method: "DELETE",
  });
}

function ConditionsSummary(r: RuleRow) {
  const hasCountries = (r.countries ?? []).length > 0;
  const hasCur = (r.orderCurrencyIn ?? []).length > 0;
  return (
    <div className="flex flex-wrap gap-1">
      {hasCountries ? (
        <Badge variant="outline">Countries: {r.countries.join(",")}</Badge>
      ) : (
        <Badge variant="secondary">Countries: ALL</Badge>
      )}
      {hasCur ? (
        <Badge variant="outline">Currency: {r.orderCurrencyIn.join(",")}</Badge>
      ) : (
        <Badge variant="secondary">Currency: ALL</Badge>
      )}
    </div>
  );
}

function ActionSummary(r: RuleRow) {
  if (r.action === "send_coupon") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span>Send coupon</span>
        {r.payload?.couponId ? (
          <span className="text-muted-foreground">· {r.payload.couponId}</span>
        ) : null}
        {r.payload?.code ? (
          <span className="text-muted-foreground">· code:{r.payload.code}</span>
        ) : null}
        <span className="ml-1 flex gap-1">
          {(r.channels ?? []).map((c) => (
            <Badge key={c} variant="outline">
              {c}
            </Badge>
          ))}
        </span>
      </div>
    );
  }
  if (r.action === "product_recommendation") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span>Recommend product</span>
        {Array.isArray(r.payload?.productIds) && r.payload.productIds.length ? (
          <span className="text-muted-foreground">· {r.payload.productIds.join(",")}</span>
        ) : null}
        {r.payload?.collectionId ? (
          <span className="text-muted-foreground">· collection:{r.payload.collectionId}</span>
        ) : null}
        <span className="ml-1 flex gap-1">
          {(r.channels ?? []).map((c) => (
            <Badge key={c} variant="outline">
              {c}
            </Badge>
          ))}
        </span>
      </div>
    );
  }
  return <span>-</span>;
}

export default async function RulesIndexPage() {
  const rows = await getRules();

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Conditional rules</h1>
          <p className="text-sm text-muted-foreground">Automate actions based on events and conditions.</p>
        </div>
        <Button asChild>
          <Link href="/conditional-rules/new">New rule</Link>
        </Button>
      </div>

      <div className="overflow-x-auto rounded-2xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="p-3 text-left">Name</th>
              <th className="p-3 text-left">Event</th>
              <th className="p-3 text-left">Conditions</th>
              <th className="p-3 text-left">Action</th>
              <th className="p-3 text-left">Priority</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-3 font-medium">{r.name}</td>
                <td className="p-3">{r.event}</td>
                <td className="p-3">
                  <ConditionsSummary {...r} />
                </td>
                <td className="p-3">
                  <ActionSummary {...r} />
                </td>
                <td className="p-3">{r.priority ?? 100}</td>
                <td className="p-3">
                  {r.enabled ? (
                    <Badge variant="default">Enabled</Badge>
                  ) : (
                    <Badge variant="secondary">Disabled</Badge>
                  )}
                </td>
                <td className="p-3 text-right">
                  <div className="flex justify-end gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/conditional-rules/edit/${r.id}`}>Edit</Link>
                    </Button>

                    {r.enabled ? (
                      <form action={toggleEnabled.bind(null, r.id, false)}>
                        <Button size="sm" type="submit" variant="secondary">
                          Disable
                        </Button>
                      </form>
                    ) : (
                      <form action={toggleEnabled.bind(null, r.id, true)}>
                        <Button size="sm" type="submit" variant="secondary">
                          Enable
                        </Button>
                      </form>
                    )}

                    <form action={removeRule.bind(null, r.id)}>
                      <Button type="submit" size="sm" variant="destructive">
                        Delete
                      </Button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}

            {rows.length === 0 && (
              <tr>
                <td className="p-6 text-center text-muted-foreground" colSpan={7}>
                  No rules yet. Click “New rule” to create your first automation.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
