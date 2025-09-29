// src/app/(dashboard)/conditional-rules/components/RuleForm.tsx
"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useForm, Controller, useFieldArray } from "react-hook-form";
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

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { HelpCircle } from "lucide-react";

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import ChannelsPicker, { Channel } from "./ChannelPicker";
import OrgCountriesSelect from "./OrgCountriesSelect";
import CouponSelect from "./CouponSelect";
import ProductMulti from "./ProductMulti";
import ConditionsBuilder, { type ConditionsGroup } from "./ConditionsBuilder";

// WYSIWYG editor
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
const scopeEnum = z.enum(["per_order", "per_customer"]); // NEW

// UI action item (no subject/body here—shared at rule level)
const UiActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("send_coupon"),
    payload: z.object({ couponId: z.string().optional().nullable() }),
  }),
  z.object({
    type: z.literal("product_recommendation"),
    payload: z.object({ productIds: z.array(z.string()).optional() }),
  }),
  z.object({
    type: z.literal("multiply_points"),
    payload: z.object({
      factor: z.coerce.number().positive("Multiplier must be > 0"),
      description: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal("award_points"),
    payload: z.object({
      points: z.coerce
        .number()
        .positive("Points must be > 0")
        .refine((n) => Math.round(n * 10) === n * 10, "Max one decimal place"),
      description: z.string().optional(),
    }),
  }),
]);

const ConditionsSchema = z
  .object({
    op: z.enum(["AND", "OR"]),
    items: z
      .array(
        z.discriminatedUnion("kind", [
          z.object({
            kind: z.literal("contains_product"),
            productIds: z.array(z.string()).min(1),
          }),
          z.object({
            kind: z.literal("order_total_gte_eur"),
            amount: z.coerce.number().min(0),
          }),
          z.object({
            kind: z.literal("no_order_days_gte"),
            days: z.coerce.number().int().min(1),
          }),
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
  templateMessage: z.string().optional(),

  // run scope (lives in payload on the server)
  runScope: scopeEnum.default("per_order"), // NEW

  // one conditions group per rule (applies to all actions)
  conditions: ConditionsSchema.optional(),

  // multiple actions; they only carry data (couponId/productIds)
  actions: z.array(UiActionSchema).min(1, "Add at least one action"),
});

export type RuleFormValues = z.infer<typeof RuleSchema>;
type ActionItem = z.infer<typeof UiActionSchema>;

type ConditionKind =
  | "contains_product"
  | "order_total_gte_eur"
  | "no_order_days_gte";

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

function isOrderEvent(ev: string) {
  return ORDER_EVENTS.has(ev as any);
}

const numberInputStep01 = { step: 0.1, inputMode: "decimal" as const };

// Helper: tooltip icon
function Hint({ text, className }: { text: string; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Help"
          className={`inline-flex items-center text-muted-foreground hover:text-foreground focus:outline-none ${className || ""}`}
        >
          <HelpCircle className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-sm">{text}</TooltipContent>
    </Tooltip>
  );
}

// Safe JSON parse (returns input if already object or parse fails)
function parseMaybeJson<T = any>(v: any): T {
  if (!v) return v as T;
  if (typeof v === "object") return v as T;
  if (typeof v !== "string") return v as T;
  try {
    return JSON.parse(v) as T;
  } catch {
    return v as T;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Normalization helpers for legacy/varied stored rule action shapes
// Ensures previously-saved actions rehydrate into the UI as expected.
// ──────────────────────────────────────────────────────────────────────────────
type AnyAction = {
  type?: string;
  kind?: string;
  action?: string;
  payload?: any;
  [k: string]: any;
};

function normalizeActionType(t?: string): ActionItem["type"] {
  const s = String(t || "").toLowerCase();
  if (s === "send_coupon") return "send_coupon";
  if (s === "product_recommendation" || s === "recommend_product" || s === "recommend_products")
    return "product_recommendation";
  if (s === "multiply_points" || s === "set_points_multiplier" || s === "points_multiplier")
    return "multiply_points";
  if (s === "award_points" || s === "grant_points") return "award_points";
  // default safely to coupon (UI already guards with validation)
  return "send_coupon";
}

function toArray<T = any>(v: any): T[] {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  return [v as T];
}

function extractIds(arr: any[]): string[] {
  return arr
    .map((x) => {
      if (typeof x === "string") return x;
      if (x && typeof x === "object" && typeof x.id === "string") return x.id;
      return null;
    })
    .filter(Boolean) as string[];
}

function normalizeOneAction(raw: AnyAction): ActionItem {
  const type = normalizeActionType(raw.type ?? raw.kind ?? raw.action);
  const p = raw.payload ?? raw;

  if (type === "send_coupon") {
    const couponId =
      p?.couponId ??
      p?.coupon_id ??
      (typeof p?.coupon === "string" ? p.coupon : p?.coupon?.id) ??
      null;
    return { type, payload: { couponId: couponId ?? null } } as ActionItem;
  }

  if (type === "product_recommendation") {
    const productIds =
      p?.productIds ?? p?.product_ids ?? extractIds(toArray(p?.products ?? p?.items ?? []));
    return { type, payload: { productIds: toArray(productIds) } } as ActionItem;
  }

  if (type === "multiply_points") {
    const factorRaw = p?.factor ?? p?.multiplier ?? raw?.factor ?? raw?.multiplier;
    const factor = Number(factorRaw);
    return {
      type,
      payload: {
        factor: Number.isFinite(factor) && factor > 0 ? factor : 1,
        description: p?.description ?? "",
      },
    } as ActionItem;
  }

  if (type === "award_points") {
    const pointsRaw = p?.points ?? raw?.points;
    const points = Number(pointsRaw);
    return {
      type,
      payload: {
        points: Number.isFinite(points) && points > 0 ? points : 0.1,
        description: p?.description ?? "",
      },
    } as ActionItem;
  }

  // fallback (keeps form usable)
  return { type: "send_coupon", payload: {} } as ActionItem;
}

function normalizeActions(input: any): ActionItem[] {
  const arr = toArray<AnyAction>(input).filter(Boolean);
  if (!arr.length) return [];
  return arr.map(normalizeOneAction);
}

// Accept an "object map" actions payload, e.g.
// { send_coupon: {...}, product_recommendation: {...} }
// and normalize to an array of { type, payload }.
function normalizeActionsObjectMap(maybeObj: any): ActionItem[] {
  if (!maybeObj || typeof maybeObj !== "object" || Array.isArray(maybeObj)) return [];
  const out: AnyAction[] = [];
  for (const [k, v] of Object.entries(maybeObj)) {
    out.push({ type: k, payload: v });
  }
  return normalizeActions(out);
}

function ensureArrayActions(actions: any): ActionItem[] {
  if (Array.isArray(actions)) return normalizeActions(actions);
  return normalizeActionsObjectMap(actions);
}

export default function RuleForm({
  defaultValues,
  mode,
  id,
  existingSingle,
}: {
  defaultValues?: Partial<RuleFormValues> | any;
  mode: "create" | "edit";
  id?: string;
  existingSingle?: {
    event: string;
    action: "send_coupon" | "product_recommendation" | "multi";
    channels: Channel[] | string[];
    payload: any;
  };
}) {
  const router = useRouter();

  const form = useForm<RuleFormValues>({
    resolver: zodResolver(RuleSchema),
    shouldUnregister: false,
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
      runScope: "per_order", // default for order events
      conditions: { op: "AND", items: [] },
      actions: [{ type: "send_coupon", payload: {} }],
    },
  });

  // Field-array binding for actions
  const {
    fields: actionFields,
    append: appendAction,
    remove: removeActionRHF,
    update: updateActionRHF,
    replace: replaceActions,
  } = useFieldArray({ control: form.control, name: "actions" });

  // Normalize legacy defaults AND pick up payload.scope if present.
  React.useEffect(() => {
    if (!defaultValues) return;
    const dv: any = defaultValues;

    // Prefer single-rule info coming from `existingSingle` when editing.
    const es = existingSingle ?? {};
    const payload = parseMaybeJson(dv.payload) || parseMaybeJson(es.payload) || {};

    const inferredEvent: string = (dv.event as string) || (es as any).event || "order_paid";

    const inferredScope: "per_order" | "per_customer" =
      inferredEvent === "customer_inactive"
        ? "per_customer"
        : payload.scope === "per_customer"
        ? "per_customer"
        : "per_order";

    // Channels accepted by this UI
    const allowedChannels = new Set<Channel>(["email", "telegram"]);
    const rawChannels = (dv.channels as any[]) ?? ((es as any).channels as any[]) ?? ["email"];
    const channels: Channel[] = Array.isArray(rawChannels)
      ? (rawChannels.filter((c) => allowedChannels.has(c)) as Channel[])
      : ["email"];
    if (!channels.length) channels.push("email");

    // Build actions from any of several shapes
    let actions: ActionItem[] = [];
    const dvActionsParsed = parseMaybeJson(dv.actions);
    const payloadActionsParsed = parseMaybeJson(payload?.actions);

    if (dvActionsParsed) {
      actions = ensureArrayActions(dvActionsParsed);
    } else if (payloadActionsParsed) {
      actions = ensureArrayActions(payloadActionsParsed);
    } else if (es && typeof (es as any).action === "string") {
      const singleType = (es as any).action;
      if (singleType === "send_coupon") {
        actions = ensureArrayActions([
          { type: "send_coupon", payload: { couponId: payload?.couponId ?? null } },
        ]);
      } else if (singleType === "product_recommendation") {
        actions = ensureArrayActions([
          { type: "product_recommendation", payload: { productIds: payload?.productIds ?? [] } },
        ]);
      } else if (
        singleType === "multiply_points" ||
        singleType === "set_points_multiplier" ||
        singleType === "points_multiplier"
      ) {
        actions = ensureArrayActions([
          { type: "multiply_points", payload: { factor: payload?.factor ?? payload?.multiplier ?? 1 } },
        ]);
      } else if (singleType === "award_points" || singleType === "grant_points") {
        actions = ensureArrayActions([{ type: "award_points", payload: { points: payload?.points ?? 0.1 } }]);
      }
    }

    // Only auto-insert a default action for CREATE mode. EDIT shows empty state
    if (!actions.length && mode === "create") {
      actions = [{ type: "send_coupon", payload: {} }];
    }

    form.reset({
      name: dv.name ?? "",
      description: dv.description ?? "",
      enabled: dv.enabled ?? true,
      priority: dv.priority ?? 100,
      event: inferredEvent,
      countries: Array.isArray(dv.countries) ? dv.countries : [],
      channels,
      templateSubject: payload.templateSubject ?? "",
      templateMessage: payload.templateMessage ?? "",
      runScope: inferredScope,
      conditions: payload.conditions ?? { op: "AND", items: [] },
      actions,
    } as RuleFormValues);

    // Sync the field-array immediately after reset so UI renders values
    replaceActions(actions as any);
  }, [defaultValues, existingSingle]); // eslint-disable-line react-hooks/exhaustive-deps

  const disabled = form.formState.isSubmitting;

  // Watch specific fields; fall back to current values to avoid gaps after reset
  const actionsValues =
    (form.watch("actions") ?? form.getValues("actions") ?? []) as ActionItem[];
  const currentEvent = form.watch("event") ?? form.getValues("event");
  const w = {
    templateSubject: form.watch("templateSubject"),
    templateMessage: form.watch("templateMessage"),
    countries: form.watch("countries"),
    runScope: form.watch("runScope"),
    enabled: form.watch("enabled"),
    conditions: form.watch("conditions"),
    channels: form.watch("channels"),
  };

  const allowedKinds = allowedKindsForEvent(currentEvent);

  // If user selects "customer_inactive", force per_customer in the UI.
  React.useEffect(() => {
    if (currentEvent === "customer_inactive" && w.runScope !== "per_customer") {
      form.setValue("runScope", "per_customer", { shouldDirty: true });
    }
  }, [currentEvent]); // eslint-disable-line react-hooks/exhaustive-deps

  const ensureCouponIfUsed = (): string | null => {
    const acts = form.getValues("actions") || [];
    for (let i = 0; i < acts.length; i++) {
      const a = acts[i] as ActionItem;
      if (a.type === "send_coupon" && !(a as any).payload?.couponId) {
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

    const serverBody = {
      name: values.name,
      description: values.description,
      enabled: values.enabled,
      priority: values.priority,
      event: values.event,
      countries: values.countries,
      channels: values.channels,
      action: "multi",
      payload: {
        templateSubject: values.templateSubject,
        templateMessage: values.templateMessage,
        conditions: values.conditions,
        actions: values.actions,
        scope: values.runScope, // NEW → backend uses this for dedupe
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
    const cur = (form.getValues(`actions.${idx}`) || {}) as ActionItem;
    updateActionRHF(idx, { ...(cur as any), ...(patch as any) });
    form.trigger("actions");
  };

  const addAction = () => {
    appendAction({ type: "send_coupon", payload: {} } as any);
  };

  const removeAction = (idx: number) => {
    // Allow removing down to zero in EDIT mode; in CREATE we keep at least one
    if (mode === "create" && actionFields.length <= 1) return;
    removeActionRHF(idx);
  };

  return (
    <TooltipProvider delayDuration={150}>
      <form className="grid gap-6" onSubmit={form.handleSubmit(onSubmit)}>
        {/* Basic */}
        <section className="grid gap-4 rounded-2xl border p-4 md:p-6">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="name">Name</Label>
                <Hint text="A short label you’ll recognize later in the rules list." />
              </div>
              <Input id="name" {...form.register("name")} disabled={disabled} />
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="priority">Priority</Label>
                <Hint text="Lower number runs earlier. Ties are broken by the newest rule. Priority does not stop other rules from running." />
              </div>
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
            <div className="flex items-center gap-2">
              <Label htmlFor="description">Description</Label>
              <Hint text="Optional note for teammates. Customers never see this." />
            </div>
            <Textarea id="description" rows={3} {...form.register("description")} disabled={disabled} />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label>Trigger</Label>
                <Hint text="When should this rule check and run? Choose an order status or 'customer inactive'." />
              </div>
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
                checked={w.enabled}
                onCheckedChange={(v) => form.setValue("enabled", v)}
                disabled={disabled}
              />
              <div className="flex items-center gap-2">
                <Label htmlFor="enabled">Enabled</Label>
                <Hint text="Turn off to keep the rule without running it. You can re-enable anytime." />
              </div>
            </div>
          </div>
        </section>

        {/* Run scope (per order / per customer) */}
        <section className="grid gap-4 rounded-2xl border p-4 md:p-6">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Run scope</h2>
            <Hint text="Decide how often this rule can fire. Per order = once for each order. Per customer = only once ever for that customer." />
          </div>
          <div className="space-y-2">
            <RadioGroup
              value={w.runScope}
              onValueChange={(v) =>
                form.setValue("runScope", v as "per_order" | "per_customer", { shouldDirty: true })
              }
              className="grid md:grid-cols-2 gap-3"
            >
              <label className="flex items-start gap-3 rounded-xl border p-3">
                <RadioGroupItem
                  value="per_order"
                  id="scope-order"
                  disabled={disabled || (form.watch("event") ?? form.getValues("event")) === "customer_inactive"}
                />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Per order</span>
                    <Hint text="We’ll run this rule once for each order that matches. If a customer places 3 orders, it can run 3 times (one per order)." />
                  </div>
                  {currentEvent === "customer_inactive" && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Not available for “customer inactive” (there’s no order for that trigger).
                    </p>
                  )}
                </div>
              </label>

              <label className="flex items-start gap-3 rounded-xl border p-3">
                <RadioGroupItem value="per_customer" id="scope-customer" disabled={disabled} />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Per customer</span>
                    <Hint text="We’ll run this rule only once for each customer, across all time. Even if they make future orders, it won’t re-run." />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Tip: For re-engagement cycles, consider separate rules (e.g., a different coupon at 60/120 days).
                  </p>
                </div>
              </label>
            </RadioGroup>
          </div>
        </section>

        {/* Countries & Conditions */}
        <section className="grid gap-6 rounded-2xl border p-4 md:p-6">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Conditions</h2>
            <Hint text="Extra filters the order/customer must pass. e.g. order total ≥ amount, contains a product, or no orders for N days." />
          </div>

          <OrgCountriesSelect value={w.countries} onChange={(codes) => form.setValue("countries", codes)} disabled={disabled} />

          <ConditionsBuilder
            value={(w.conditions ?? ({ op: "AND", items: [] } as ConditionsGroup)) as ConditionsGroup}
            onChange={(v) => form.setValue("conditions", v, { shouldDirty: true })}
            disabled={disabled}
            allowedKinds={allowedKinds}
            ruleCountries={w.countries}
          />
        </section>

        {/* Delivery */}
        <section className="grid gap-6 rounded-2xl border p-4 md:p-6">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Delivery</h2>
            <Hint text="Where to send the message. Pick one or more channels." />
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label>Channels</Label>
              <Hint text="Email and/or Telegram. We’ll deliver the same message to each selected channel." />
            </div>
            <ChannelsPicker
              value={(w.channels as Channel[]) ?? []}
              onChange={(v) => form.setValue("channels", v)}
              disabled={disabled}
            />
          </div>
        </section>

        {/* Actions (data only) */}
        <section className="grid gap-4 rounded-2xl border p-4 md:p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">Actions</h2>
              <Hint text="What to include in the message. You can combine actions (e.g., send a coupon and recommend products) and use placeholders in one body." />
            </div>
            <Button type="button" onClick={addAction} disabled={disabled}>
              + Add action
            </Button>
          </div>

          {/* In EDIT mode, do not inject a phantom default row.
              In CREATE mode, defaultValues already include one. */}
          {actionFields.length === 0 && mode === "edit" && (
            <div className="text-sm text-muted-foreground">No actions in this rule yet. Add one above.</div>
          )}

          {actionFields.map((field, idx) => {
            const a = (actionsValues[idx] ?? field) as ActionItem;

            return (
              <div key={field.id} className="rounded-xl border p-4 md:p-6 grid gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Label className="min-w-24">Type</Label>
                    <Hint text="Choose the kind of content this action contributes: a coupon or a set of products." />
                  </div>
                  <Select
                    value={(a as any).type ?? ""}
                    onValueChange={(v) =>
                      updateAction(idx, {
                        type: v as ActionItem["type"],
                        payload: {},
                      })
                    }
                    disabled={disabled}
                  >
                    <SelectTrigger className="w-64">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="send_coupon">Send coupon</SelectItem>
                      <SelectItem value="product_recommendation">Recommend product</SelectItem>
                      {isOrderEvent(currentEvent) && (
                        <SelectItem value="multiply_points">Set points multiplier</SelectItem>
                      )}
                      <SelectItem value="award_points">Award fixed points</SelectItem>
                    </SelectContent>
                  </Select>

                  <div className="ml-auto">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => removeAction(idx)}
                      disabled={disabled || (mode === "create" && actionFields.length <= 1)}
                    >
                      − Remove
                    </Button>
                  </div>
                </div>

                {(a as any).type === "send_coupon" && (
                  <div className="grid gap-4">
                    <div className="flex items-center gap-2">
                      <Label>Coupon</Label>
                      <Hint text="Pick a coupon valid for the selected countries. In the message body, use {coupon} to show its code." />
                    </div>
                    <CouponSelect
                      value={((a as any).payload?.couponId ?? null) as any}
                      onChange={(id) =>
                        updateAction(idx, {
                          payload: { ...(a as any).payload, couponId: id },
                        })
                      }
                      ruleCountries={w.countries}
                      disabled={disabled}
                    />
                    <p className="text-xs text-muted-foreground">
                      Will populate <code>{`{coupon}`}</code> in the message body.
                    </p>
                  </div>
                )}

                {(a as any).type === "multiply_points" && (
                  <div className="grid gap-4">
                    <div className="flex items-center gap-2">
                      <Label>Multiplier</Label>
                      <Hint text="Sets a multiplier for the buyer’s spending-based points on this order only. If multiple rules set it, we’ll keep the highest multiplier." />
                    </div>
                    <div className="grid md:grid-cols-2 gap-4">
                      <Input
                        type="number"
                        min={0.1}
                        {...numberInputStep01}
                        value={
                          Number.isFinite((a as any).payload?.factor)
                            ? (a as any).payload.factor
                            : ""
                        }
                        onChange={(e) =>
                          updateAction(idx, {
                            payload: {
                              ...(a as any).payload,
                              factor: Number(e.target.value || 0),
                            },
                          })
                        }
                        disabled={disabled}
                        placeholder="e.g. 1.5"
                      />
                      <Input
                        placeholder="Optional description (internal)"
                        value={(a as any).payload?.description ?? ""}
                        onChange={(e) =>
                          updateAction(idx, {
                            payload: {
                              ...(a as any).payload,
                              description: e.target.value,
                            },
                          })
                        }
                        disabled={disabled}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Applies only to spending milestone points awarded at payment time. Buyer only; referrers are not
                      affected.
                    </p>
                  </div>
                )}

                {(a as any).type === "award_points" && (
                  <div className="grid gap-4">
                    <div className="flex items-center gap-2">
                      <Label>Points</Label>
                      <Hint text="Immediately credits the buyer with a fixed number of affiliate points. Supports one decimal (e.g., 1.5). We round to the nearest 0.1." />
                    </div>
                    <div className="grid md:grid-cols-2 gap-4">
                      <Input
                        type="number"
                        min={0.1}
                        {...numberInputStep01}
                        value={
                          Number.isFinite((a as any).payload?.points)
                            ? (a as any).payload.points
                            : ""
                        }
                        onChange={(e) =>
                          updateAction(idx, {
                            payload: {
                              ...(a as any).payload,
                              points: Number(e.target.value || 0),
                            },
                          })
                        }
                        disabled={disabled}
                        placeholder="e.g. 10 or 1.5"
                      />
                      <Input
                        placeholder="Optional description (internal)"
                        value={(a as any).payload?.description ?? ""}
                        onChange={(e) =>
                          updateAction(idx, {
                            payload: {
                              ...(a as any).payload,
                              description: e.target.value,
                            },
                          })
                        }
                        disabled={disabled}
                      />
                    </div>
                  </div>
                )}

                {(a as any).type === "product_recommendation" && (
                  <div className="grid gap-4">
                    <div className="flex items-center gap-2">
                      <Label>Products to recommend</Label>
                      <Hint text="Pick one or more products. In the message body, use {selected_products} to render them as a list." />
                    </div>
                    <ProductMulti
                      label="Products to recommend"
                      value={toArray<string>((a as any).payload?.productIds ?? [])}
                      onChange={(ids) =>
                        updateAction(idx, {
                          payload: { ...(a as any).payload, productIds: ids },
                        })
                      }
                      disabled={disabled}
                      ruleCountries={w.countries}
                    />
                    <p className="text-xs text-muted-foreground">
                      Will populate <code>{`{selected_products}`}</code> (and <code>{`{recommended_products}`}</code>) in
                      the message body.
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </section>

        {/* Shared Message — at the end for clarity */}
        <section className="grid gap-6 rounded-2xl border p-4 md:p-6">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Message</h2>
            <Hint text="One message for all selected actions. Use placeholders to pull in the coupon and/or products." />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label>Subject</Label>
              <Hint text="Subject for email notifications. Telegram ignores this field." />
            </div>
            <Input
              value={w.templateSubject ?? ""}
              onChange={(e) => form.setValue("templateSubject", e.target.value, { shouldDirty: true })}
              disabled={disabled}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label>Body (HTML)</Label>
              <Hint text="Write your message with formatting. Helpful placeholders: {coupon}, {selected_products}. We’ll render the products as a list." />
            </div>
            <ReactQuill
              theme="snow"
              value={w.templateMessage ?? ""}
              onChange={(html) => form.setValue("templateMessage", html, { shouldDirty: true })}
              modules={quillModules}
            />
            <p className="text-xs text-muted-foreground">
              Placeholders: <code>{`{coupon}`}</code>, <code>{`{selected_products}`}</code> (or{" "}
              <code>{`{recommended_products}`}</code>).
            </p>
          </div>
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
    </TooltipProvider>
  );
}
