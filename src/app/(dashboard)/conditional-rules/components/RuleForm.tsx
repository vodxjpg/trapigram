"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { CountriesMulti } from "./ConditionFields";
import ConditionsBuilder, { ConditionsGroup, ConditionItem } from "./ConditionsBuilder";
import ActionsBuilder, { ActionItem } from "./ActionsBuilder";

const eventEnum = z.enum([
  "order_placed","order_pending_payment","order_paid","order_completed",
  "order_cancelled","order_refunded","order_partially_paid","order_shipped",
  "order_message","ticket_created","ticket_replied","manual",
]);

const BaseSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  enabled: z.boolean().default(true),
  priority: z.coerce.number().int().min(0).default(100),
  event: eventEnum,                    // SINGLE trigger
  countries: z.array(z.string()).default([]),
});

type FormValues = z.infer<typeof BaseSchema>;

export default function RuleForm({
  mode,
  id,
  defaultValues,
  existingRule, // when editing an existing single rule
}: {
  mode: "create" | "edit";
  id?: string;
  defaultValues?: Partial<FormValues>;
  existingRule?: {
    event: z.infer<typeof eventEnum>;
    action: "send_coupon" | "product_recommendation";
    channels: ("email" | "telegram" | "in_app" | "webhook")[];
    payload: any;
  };
}) {
  const router = useRouter();

  const form = useForm<FormValues>({
    resolver: zodResolver(BaseSchema),
    defaultValues: {
      name: "",
      description: "",
      enabled: true,
      priority: 100,
      event: "order_paid",
      countries: [],
      ...defaultValues,
    },
  });

  // Conditions (single group with AND/OR)
  const [conds, setConds] = React.useState<ConditionsGroup>(() => {
    const fromExisting = existingRule?.payload?.conditions;
    return fromExisting?.items?.length
      ? { op: fromExisting.op ?? "AND", items: fromExisting.items as ConditionItem[] }
      : { op: "AND", items: [] };
  });

  // Actions (+/−). In edit mode we seed from the single existing rule.
  const [actions, setActions] = React.useState<ActionItem[]>(() => {
    if (mode === "edit" && existingRule) {
      const a: ActionItem =
        existingRule.action === "send_coupon"
          ? {
              type: "send_coupon",
              channels: existingRule.channels as any,
              payload: {
                couponId: existingRule.payload?.couponId ?? "",
                code: existingRule.payload?.code ?? "",
                templateSubject: existingRule.payload?.templateSubject ?? "",
                templateMessage: existingRule.payload?.templateMessage ?? "",
                url: existingRule.payload?.url ?? "",
              },
            }
          : {
              type: "product_recommendation",
              channels: existingRule.channels as any,
              payload: {
                productIds: existingRule.payload?.productIds ?? [],
                collectionId: existingRule.payload?.collectionId ?? "",
                templateSubject: existingRule.payload?.templateSubject ?? "",
                templateMessage: existingRule.payload?.templateMessage ?? "",
                url: existingRule.payload?.url ?? "",
              },
            };
      return [a];
    }
    return [{ type: "send_coupon", channels: ["email"], payload: {} }];
  });

  const disabled = form.formState.isSubmitting;

  async function createRuleForAction(action: ActionItem, base: FormValues) {
    const body = {
      name: base.name,
      description: base.description,
      enabled: base.enabled,
      priority: base.priority,
      event: base.event,
      countries: base.countries,
      action: action.type,
      channels: action.channels,
      payload: { ...(action.payload as any), conditions: conds.items.length ? conds : undefined },
    };
    const res = await fetch("/api/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await res.text());
  }

  async function onSubmit(values: FormValues) {
    if (!actions.length) {
      alert("Please add at least one action.");
      return;
    }

    if (mode === "edit" && id && existingRule) {
      // Strategy: PATCH the first action into the current rule,
      // and for any extra actions create new rules. If user removed the only action, delete.
      if (actions.length === 0) {
        await fetch(`/api/rules/${id}`, { method: "DELETE" });
      } else {
        const first = actions[0];
        const res = await fetch(`/api/rules/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: values.name,
            description: values.description,
            enabled: values.enabled,
            priority: values.priority,
            event: values.event,
            countries: values.countries,
            action: first.type,
            channels: first.channels,
            payload: { ...(first.payload as any), conditions: conds.items.length ? conds : undefined },
          }),
        });
        if (!res.ok) throw new Error(await res.text());
        // Create any additional actions as new rules
        const extra = actions.slice(1);
        await Promise.all(extra.map((a) => createRuleForAction(a, values)));
      }
    } else {
      // CREATE: fan-out — one DB rule per action
      await Promise.all(actions.map((a) => createRuleForAction(a, values)));
    }

    router.push("/conditional-rules");
    router.refresh();
  }

  return (
    <form className="grid gap-6" onSubmit={form.handleSubmit(onSubmit)}>
      <section className="grid gap-4 rounded-2xl border p-4 md:p-6">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" {...form.register("name")} disabled={disabled} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="priority">Priority</Label>
            <Input id="priority" type="number" min={0} {...form.register("priority", { valueAsNumber: true })} disabled={disabled} />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea id="description" rows={3} {...form.register("description")} disabled={disabled} />
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Trigger event</Label>
            <Controller
              control={form.control}
              name="event"
              render={({ field }) => (
                <Select disabled={disabled} onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select event" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="order_placed">Order placed</SelectItem>
                    <SelectItem value="order_partially_paid">Order partially paid</SelectItem>
                    <SelectItem value="order_pending_payment">Order pending payment</SelectItem>
                    <SelectItem value="order_paid">Order paid</SelectItem>
                    <SelectItem value="order_completed">Order completed</SelectItem>
                    <SelectItem value="order_cancelled">Order cancelled</SelectItem>
                    <SelectItem value="order_refunded">Order refunded</SelectItem>
                    <SelectItem value="order_shipped">Order shipped</SelectItem>
                    <SelectItem value="order_message">Order message</SelectItem>
                    <SelectItem value="ticket_created">Ticket created</SelectItem>
                    <SelectItem value="ticket_replied">Ticket replied</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="flex items-end gap-2">
            <Switch
              id="enabled"
              checked={form.watch("enabled")}
              onCheckedChange={(v) => form.setValue("enabled", v)}
              disabled={disabled}
            />
            <Label htmlFor="enabled">Enabled</Label>
          </div>
        </div>
      </section>

      <section className="grid gap-6 rounded-2xl border p-4 md:p-6">
        <h2 className="text-lg font-semibold">Conditions</h2>
        <CountriesMulti control={form.control} name="countries" disabled={disabled} />
        <ConditionsBuilder value={conds} onChange={setConds} disabled={disabled} />
      </section>

      <section className="grid gap-6 rounded-2xl border p-4 md:p-6">
        <h2 className="text-lg font-semibold">Actions</h2>
        <ActionsBuilder actions={actions} setActions={setActions} disabled={disabled} />
      </section>

      <div className="flex gap-3">
        <Button type="submit" disabled={disabled}>
          {mode === "create" ? "Create rule(s)" : "Save changes"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => { history.length > 1 ? router.back() : router.push("/conditional-rules"); }}
          disabled={disabled}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
