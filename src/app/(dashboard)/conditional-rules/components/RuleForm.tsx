// src/app/(dashboard)/conditional-rules/components/RuleForm.tsx
"use client";

import * as React from "react";
import dynamic from "next/dynamic";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import ChannelsPicker, { Channel } from "./ChannelPicker";
import OrgCountriesSelect from "./OrgCountriesSelect";
import CouponSelect from "./CouponSelect";
import ProductMulti from "./ProductMulti";
import ConditionsBuilder, { type ConditionsGroup } from "./ConditionsBuilder";

// WYSIWYG editor (same as notification templates)
const ReactQuill = dynamic(() => import("react-quill-new"), { ssr: false });
import "react-quill-new/dist/quill.snow.css";

const quillModules = {
  toolbar: [
    [{ header: [1, 2, false] }],
    ["bold", "italic", "underline"],
    [{ list: "ordered" }, { list: "bullet" }],
    ["clean"],
  ],
};

const channelsEnum = z.enum(["email", "telegram"]);
const actionEnum = z.enum(["send_coupon", "product_recommendation"]);

// UI action item (no subject/body here—shared at rule level)
const UiActionSchema = z.object({
  type: actionEnum,
  payload: z.object({
    couponId: z.string().optional().nullable(),
    productIds: z.array(z.string()).optional(),
  }),
});

const ConditionsSchema = z
  .object({
    op: z.enum(["AND", "OR"]),
    items: z
      .array(
        z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("contains_product"), productIds: z.array(z.string()).min(1) }),
          z.object({ kind: z.literal("order_total_gte_eur"), amount: z.coerce.number().min(0) }),
          z.object({ kind: z.literal("no_order_days_gte"), days: z.coerce.number().int().min(1) }),
        ])
      )
      .min(1),
  })
  .partial();

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

  channels: z.array(channelsEnum).min(1, "Pick at least one channel"),

  // shared subject/body for all actions
  templateSubject: z.string().optional(),
  templateMessage: z.string().optional(), // HTML from Quill

  // one conditions group per rule (applies to all actions)
  conditions: ConditionsSchema.optional(),

  // multiple actions; they only carry data (couponId/productIds)
  actions: z.array(UiActionSchema).min(1, "Add at least one action"),
});

export type RuleFormValues = z.infer<typeof RuleSchema>;
type ActionItem = z.infer<typeof UiActionSchema>;

type ConditionKind = "contains_product" | "order_total_gte_eur" | "no_order_days_gte";
const ORDER_EVENTS = new Set([
  "order_placed",
  "order_partially_paid",
  "order_pending_payment",
  "order_paid",
  "order_completed",
  "order_cancelled",
  "order_refunded",
]);
const allowedKindsForEvent = (ev: string): ConditionKind[] => {
  if (ev === "customer_inactive") return ["no_order_days_gte"];
  if (ORDER_EVENTS.has(ev as any)) return ["contains_product", "order_total_gte_eur"];
  return ["contains_product", "order_total_gte_eur", "no_order_days_gte"];
};

export default function RuleForm({
  defaultValues,
  mode,
  id,
}: {
  defaultValues?: Partial<RuleFormValues> | any; // accept legacy shape when editing
  mode: "create" | "edit";
  id?: string;
}) {
  const router = useRouter();

  // sensible defaults
  const form = useForm<RuleFormValues>({
    resolver: zodResolver(RuleSchema),
    defaultValues: {
      name: "",
      description: "",
      enabled: true,
      priority: 100,
      event: "order_paid",
      countries: [],
      channels: ["email"],
      templateSubject: "",
      templateMessage: "",
      conditions: { op: "AND", items: [] },
      actions: [{ type: "send_coupon", payload: {} }],
    },
  });

  // normalize legacy defaultValues (single-action rule) into the new multi format
  React.useEffect(() => {
    if (!defaultValues) return;
    const dv: any = defaultValues;

    // if this looks like an old rule { action, channels, payload }
    if (dv.action && !dv.actions) {
      const action: ActionItem["type"] = dv.action;
      const payload = dv.payload || {};
      const actions: ActionItem[] =
        action === "send_coupon"
          ? [{ type: "send_coupon", payload: { couponId: payload.couponId ?? null } }]
          : [{ type: "product_recommendation", payload: { productIds: payload.productIds ?? [] } }];

      form.reset({
        name: dv.name ?? "",
        description: dv.description ?? "",
        enabled: dv.enabled ?? true,
        priority: dv.priority ?? 100,
        event: dv.event ?? "order_paid",
        countries: Array.isArray(dv.countries) ? dv.countries : [],
        channels: Array.isArray(dv.channels) ? (dv.channels as Channel[]) : ["email"],
        templateSubject: payload.templateSubject ?? "",
        templateMessage: payload.templateMessage ?? "",
        conditions: payload.conditions ?? { op: "AND", items: [] },
        actions,
      } as RuleFormValues);
      return;
    }

    // already new shape
    form.reset({ ...(dv as RuleFormValues) });
  }, [defaultValues]); // eslint-disable-line react-hooks/exhaustive-deps

  const disabled = form.formState.isSubmitting;
  const watch = form.watch();
  const actions = watch.actions;
  const currentEvent = watch.event;
  const allowedKinds = allowedKindsForEvent(currentEvent);

  // require coupon if a coupon action exists
  const ensureCouponIfUsed = (): string | null => {
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
    const err = ensureCouponIfUsed();
    if (err) {
      alert(err);
      return;
    }

    // build the new server payload (single rule with multi actions & shared body)
    const serverBody = {
      name: values.name,
      description: values.description,
      enabled: values.enabled,
      priority: values.priority,
      event: values.event,
      countries: values.countries,
      channels: values.channels,
      action: "multi", // <— new server-side mode
      payload: {
        templateSubject: values.templateSubject,
        templateMessage: values.templateMessage,
        conditions: values.conditions,
        actions: values.actions,
      },
    };

    const url = mode === "create" ? "/api/rules" : `/api/rules/${id}`;
    const method = mode === "create" ? "POST" : "PATCH";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(serverBody),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(typeof body?.error === "string" ? body.error : "Failed to save rule");
      return;
    }
    router.push("/conditional-rules");
    router.refresh();
  }

  const updateAction = (idx: number, patch: Partial<ActionItem>) => {
    const next = [...actions];
    next[idx] = { ...next[idx], ...patch } as ActionItem;
    form.setValue("actions", next, { shouldDirty: true });
  };

  const addAction = () => {
    form.setValue(
      "actions",
      [...actions, { type: "send_coupon", payload: {} }],
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
          value={watch.conditions ?? ({ op: "AND", items: [] } as ConditionsGroup)}
          onChange={(v) => form.setValue("conditions", v, { shouldDirty: true })}
          disabled={disabled}
          allowedKinds={allowedKinds}
        />
      </section>

      {/* Delivery */}
      <section className="grid gap-6 rounded-2xl border p-4 md:p-6">
        <h2 className="text-lg font-semibold">Delivery</h2>
        <div className="space-y-2">
          <Label>Channels</Label>
          <ChannelsPicker
            value={form.watch("channels") as Channel[]}
            onChange={(v) => form.setValue("channels", v)}
            disabled={disabled}
          />
        </div>
      </section>

      {/* Shared Message */}
      <section className="grid gap-6 rounded-2xl border p-4 md:p-6">
        <h2 className="text-lg font-semibold">Message</h2>

        <div className="space-y-2">
          <Label>Subject</Label>
          <Input
            value={watch.templateSubject ?? ""}
            onChange={(e) => form.setValue("templateSubject", e.target.value, { shouldDirty: true })}
            disabled={disabled}
          />
        </div>

        <div className="space-y-2">
          <Label>Body (HTML)</Label>
          <ReactQuill
            theme="snow"
            value={watch.templateMessage ?? ""}
            onChange={(html) => form.setValue("templateMessage", html, { shouldDirty: true })}
            modules={quillModules}
          />
          <p className="text-xs text-muted-foreground">
            Placeholders: <code>{`{coupon}`}</code>, <code>{`{selected_products}`}</code> (or <code>{`{recommended_products}`}</code>).
          </p>
        </div>
      </section>

      {/* Actions (data only) */}
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

              <div className="ml-auto">
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

            {a.type === "send_coupon" && (
              <div className="grid gap-4">
                <CouponSelect
                  value={a.payload?.couponId ?? null}
                  onChange={(id) => updateAction(idx, { payload: { ...a.payload, couponId: id } })}
                  ruleCountries={form.watch("countries")}
                  disabled={disabled}
                />
                <p className="text-xs text-muted-foreground">
                  Will populate <code>{`{coupon}`}</code> in the message body.
                </p>
              </div>
            )}

            {a.type === "product_recommendation" && (
              <div className="grid gap-4">
                <ProductMulti
                  label="Products to recommend"
                  value={(a.payload?.productIds ?? []) as string[]}
                  onChange={(ids) => updateAction(idx, { payload: { ...a.payload, productIds: ids } })}
                  disabled={disabled}
                />
                <p className="text-xs text-muted-foreground">
                  Will populate <code>{`{selected_products}`}</code> (and <code>{`{recommended_products}`}</code>) in the message body.
                </p>
              </div>
            )}
          </div>
        ))}
      </section>

      <div className="flex gap-3">
        <Button type="submit" disabled={disabled}>
          {mode === "create" ? "Create rule" : "Save changes"}
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
