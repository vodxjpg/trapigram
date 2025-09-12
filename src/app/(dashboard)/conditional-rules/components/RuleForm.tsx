// src/app/(dashboard)/conditional-rules/components/RuleForm.tsx
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

import ChannelsPicker, { Channel } from "./ChannelPicker";
import OrgCountriesSelect from "./OrgCountriesSelect";
import CouponSelect from "./CouponSelect";
import ProductMulti from "./ProductMulti";
import ConditionsBuilder, { type ConditionsGroup } from "./ConditionsBuilder";

const channelsEnum = z.enum(["email", "telegram"]);
const actionEnum = z.enum(["send_coupon", "product_recommendation"]);

const ConditionsSchema = z.object({
  op: z.enum(["AND", "OR"]),
  items: z.array(
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("contains_product"), productIds: z.array(z.string()).min(1) }),
      z.object({ kind: z.literal("order_total_gte_eur"), amount: z.coerce.number().min(0) }),
      z.object({ kind: z.literal("no_order_days_gte"), days: z.coerce.number().int().min(1) }),
    ])
  ).min(1),
}).partial();

const SingleActionSchema = z.object({
  type: actionEnum,
  channels: z.array(channelsEnum).min(1, "Pick at least one channel"),
  payload: z.object({
    couponId: z.string().optional().nullable(),           // required when type = send_coupon
    templateSubject: z.string().optional(),
    templateMessage: z.string().optional(),
    url: z.string().url().optional().nullable(),
    productIds: z.array(z.string()).optional(),           // for product_recommendation
  }),
});

export const RuleSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional().nullable(),
  enabled: z.boolean().default(true),
  priority: z.coerce.number().int().min(0).default(100),
  event: z.enum([
    "order_placed",
    "order_partially_paid",
    "order_pending_payment",
    "order_paid",
    "order_completed",
    "order_cancelled",
    "order_refunded",
    "customer_inactive",
  ]),
  countries: z.array(z.string()).default([]),

  // One set of conditions for the rule (applies to all actions)
  conditions: ConditionsSchema.optional(),

  // 🔥 Multiple actions
  actions: z.array(SingleActionSchema).min(1, "Add at least one action"),
});

export type RuleFormValues = z.infer<typeof RuleSchema>;
type ActionItem = z.infer<typeof SingleActionSchema>;

export default function RuleForm({
  defaultValues,
  mode,
  id,
}: {
  defaultValues?: Partial<RuleFormValues>;
  mode: "create" | "edit";
  id?: string;
}) {
  const router = useRouter();
  const form = useForm<RuleFormValues>({
    resolver: zodResolver(RuleSchema),
    defaultValues: {
      name: "",
      description: "",
      enabled: true,
      priority: 100,
      event: "order_paid",
      countries: [],
      conditions: { op: "AND", items: [] },
      actions: [
        {
          type: "send_coupon",
          channels: ["email"],
          payload: {},
        },
      ],
      ...defaultValues,
    },
  });

  const disabled = form.formState.isSubmitting;
  const watch = form.watch();

  const ensureSendCouponHasCoupon = (): string | null => {
    const acts = form.getValues("actions") || [];
    for (let i = 0; i < acts.length; i++) {
      const a = acts[i];
      if (a.type === "send_coupon" && !a.payload?.couponId) {
        return `Action #${i + 1}: Please select a coupon.`;
      }
    }
    return null;
  };

  async function onSubmit(values: RuleFormValues) {
    // quick client validation for coupon selection
    const couponErr = ensureSendCouponHasCoupon();
    if (couponErr) {
      alert(couponErr);
      return;
    }

    // Helper: map our multi-action shape → backend’s single-action payload
    const toBackend = (base: RuleFormValues, action: ActionItem) => ({
      name: base.name,
      description: base.description,
      enabled: base.enabled,
      priority: base.priority,
      event: base.event,
      countries: base.countries,
      action: action.type,
      channels: action.channels,
      payload: {
        ...action.payload,
        // carry rule-level conditions down to each rule’s payload
        ...(base.conditions ? { conditions: base.conditions } : {}),
      },
    });

    try {
      if (mode === "create") {
        // Create one rule per action to stay compatible with current API
        const bodies = values.actions.map((a) => toBackend(values, a));
        for (const body of bodies) {
          const r = await fetch("/api/rules", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!r.ok) {
            const b = await r.json().catch(() => ({}));
            throw new Error(typeof b?.error === "string" ? b.error : "Failed to create rule");
          }
        }
      } else {
        // Edit: patch this rule with the first action, create extra rules for the rest
        const [first, ...rest] = values.actions;
        if (!first) throw new Error("At least one action is required");

        // PATCH current rule
        {
          const body = toBackend(values, first);
          const r = await fetch(`/api/rules/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!r.ok) {
            const b = await r.json().catch(() => ({}));
            throw new Error(typeof b?.error === "string" ? b.error : "Failed to save rule");
          }
        }

        // Create additional rules for remaining actions (suffix name)
        let idx = 2;
        for (const a of rest) {
          const clone: RuleFormValues = {
            ...values,
            name: `${values.name} — action #${idx}`,
            actions: [a],
          };
          const r = await fetch("/api/rules", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(toBackend(clone, a)),
          });
          if (!r.ok) {
            const b = await r.json().catch(() => ({}));
            throw new Error(typeof b?.error === "string" ? b.error : "Failed to create extra action");
          }
          idx += 1;
        }
      }

      router.push("/conditional-rules");
      router.refresh();
    } catch (err: any) {
      alert(err?.message || "Failed to save rule(s)");
    }
  }

  const conditions: ConditionsGroup =
    watch.conditions ?? ({ op: "AND", items: [] } as ConditionsGroup);

  const actions = watch.actions;

  const updateAction = (idx: number, patch: Partial<ActionItem>) => {
    const next = [...actions];
    next[idx] = { ...next[idx], ...patch } as ActionItem;
    form.setValue("actions", next, { shouldDirty: true });
  };

  const addAction = () => {
    form.setValue(
      "actions",
      [
        ...actions,
        { type: "send_coupon", channels: ["email"], payload: {} },
      ],
      { shouldDirty: true }
    );
  };

  const removeAction = (idx: number) => {
    if (actions.length <= 1) return;
    form.setValue(
      "actions",
      actions.filter((_, i) => i !== idx),
      { shouldDirty: true }
    );
  };

  return (
    <form className="grid gap-6" onSubmit={form.handleSubmit(onSubmit)}>
      {/* Basic */}
      <section className="grid gap-4 rounded-2xl border p-4 md:p-6">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" {...form.register("name")} disabled={disabled} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="priority">Priority</Label>
            <Input
              id="priority"
              type="number"
              min={0}
              {...form.register("priority", { valueAsNumber: true })}
              disabled={disabled}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea id="description" rows={3} {...form.register("description")} disabled={disabled} />
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Trigger</Label>
            <Controller
              control={form.control}
              name="event"
              render={({ field }) => (
                <Select disabled={disabled} onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select trigger" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="order_placed">Order placed</SelectItem>
                    <SelectItem value="order_partially_paid">Order partially paid</SelectItem>
                    <SelectItem value="order_pending_payment">Order pending payment</SelectItem>
                    <SelectItem value="order_paid">Order paid</SelectItem>
                    <SelectItem value="order_completed">Order completed</SelectItem>
                    <SelectItem value="order_cancelled">Order cancelled</SelectItem>
                    <SelectItem value="order_refunded">Order refunded</SelectItem>
                    <SelectItem value="customer_inactive">Customer inactive</SelectItem>
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

      {/* Countries & Conditions */}
      <section className="grid gap-6 rounded-2xl border p-4 md:p-6">
        <h2 className="text-lg font-semibold">Conditions</h2>

        <OrgCountriesSelect
          value={form.watch("countries")}
          onChange={(codes) => form.setValue("countries", codes)}
          disabled={disabled}
        />

        <ConditionsBuilder
          value={conditions}
          onChange={(v) => form.setValue("conditions", v, { shouldDirty: true })}
          disabled={disabled}
        />
      </section>

      {/* Actions (multiple) */}
      <section className="grid gap-4 rounded-2xl border p-4 md:p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Actions</h2>
          <Button type="button" onClick={addAction} disabled={disabled}>
            + Add action
          </Button>
        </div>

        {actions.map((a, idx) => (
          <div key={idx} className="rounded-xl border p-4 md:p-6 grid gap-4">
            <div className="flex items-center gap-3">
              <Label className="min-w-24">Type</Label>
              <Select
                value={a.type}
                onValueChange={(v) => updateAction(idx, { type: v as ActionItem["type"], payload: {} })}
                disabled={disabled}
              >
                <SelectTrigger className="w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="send_coupon">Send coupon</SelectItem>
                  <SelectItem value="product_recommendation">Recommend product</SelectItem>
                </SelectContent>
              </Select>

              <div className="ml-auto flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => removeAction(idx)}
                  disabled={disabled || actions.length <= 1}
                >
                  − Remove
                </Button>
              </div>
            </div>

            {/* Channels per action */}
            <div className="space-y-2">
              <Label>Channels</Label>
              <ChannelsPicker
                value={a.channels as Channel[]}
                onChange={(v) => updateAction(idx, { channels: v as Channel[] })}
                disabled={disabled}
              />
            </div>

            {/* Fields per action type */}
            {a.type === "send_coupon" && (
              <div className="grid md:grid-cols-2 gap-4">
                <CouponSelect
                  value={a.payload?.couponId ?? null}
                  onChange={(id) => updateAction(idx, { payload: { ...a.payload, couponId: id } })}
                  ruleCountries={form.watch("countries")}
                  disabled={disabled}
                />

                <div className="space-y-2 md:col-span-2">
                  <Label>Subject</Label>
                  <Input
                    value={a.payload?.templateSubject ?? ""}
                    onChange={(e) => updateAction(idx, { payload: { ...a.payload, templateSubject: e.target.value } })}
                    disabled={disabled}
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label>Message (HTML allowed)</Label>
                  <Textarea
                    rows={5}
                    value={a.payload?.templateMessage ?? ""}
                    onChange={(e) => updateAction(idx, { payload: { ...a.payload, templateMessage: e.target.value } })}
                    disabled={disabled}
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label>URL (optional)</Label>
                  <Input
                    value={a.payload?.url ?? ""}
                    onChange={(e) => updateAction(idx, { payload: { ...a.payload, url: e.target.value } })}
                    disabled={disabled}
                  />
                </div>
              </div>
            )}

            {a.type === "product_recommendation" && (
              <div className="grid md:grid-cols-2 gap-4">
                <ProductMulti
                  label="Products to recommend"
                  value={(a.payload?.productIds ?? []) as string[]}
                  onChange={(ids) => updateAction(idx, { payload: { ...a.payload, productIds: ids } })}
                  disabled={disabled}
                />

                <div className="space-y-2 md:col-span-2">
                  <Label>Subject</Label>
                  <Input
                    value={a.payload?.templateSubject ?? ""}
                    onChange={(e) => updateAction(idx, { payload: { ...a.payload, templateSubject: e.target.value } })}
                    disabled={disabled}
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label>Message (HTML allowed)</Label>
                  <Textarea
                    rows={5}
                    value={a.payload?.templateMessage ?? ""}
                    onChange={(e) => updateAction(idx, { payload: { ...a.payload, templateMessage: e.target.value } })}
                    disabled={disabled}
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label>URL (optional)</Label>
                  <Input
                    value={a.payload?.url ?? ""}
                    onChange={(e) => updateAction(idx, { payload: { ...a.payload, url: e.target.value } })}
                    disabled={disabled}
                  />
                </div>
              </div>
            )}
          </div>
        ))}
      </section>

      <div className="flex gap-3">
        <Button type="submit" disabled={disabled}>
          {mode === "create" ? "Create rule(s)" : "Save changes"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            history.length > 1 ? router.back() : router.push("/conditional-rules");
          }}
          disabled={disabled}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
