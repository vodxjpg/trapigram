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
const scopeEnum = z.enum(["per_order", "per_customer"]);

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
            kind: z.literal("order_total_gte"),
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

/** Repeat every N days for customer_inactive (optional for other events) */
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
  runScope: scopeEnum.default("per_order"),

  // one conditions group per rule (applies to all actions)
  conditions: ConditionsSchema.optional(),

  // multiple actions; they only carry data (couponId/productIds)
  actions: z.array(UiActionSchema).min(1, "Add at least one action"),

  cooldownDays: z.coerce.number().int().min(1).optional(),
});

export type RuleFormValues = z.infer<typeof RuleSchema>;
type ActionItem = z.infer<typeof UiActionSchema>;

type ConditionKind =
  | "contains_product"
  | "order_total_gte"
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
  if (ORDER_EVENTS.has(ev as any)) return ["contains_product", "order_total_gte"];
  return ["contains_product", "order_total_gte", "no_order_days_gte"];
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
// Normalization helpers for legacy/varied stored rule action/condition shapes
// ─────────────────────────────────────────────────────────────────────────────-
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

  return { type: "send_coupon", payload: {} } as ActionItem;
}

function normalizeActions(input: any): ActionItem[] {
  const arr = toArray<AnyAction>(input).filter(Boolean);
  if (!arr.length) return [];
  return arr.map(normalizeOneAction);
}

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

// Convert legacy condition kind to the new one in-place
function normalizeConditionsGroup(cg: any): ConditionsGroup | undefined {
  if (!cg || typeof cg !== "object") return undefined;
  const op = (cg.op === "OR" ? "OR" : "AND") as "AND" | "OR";
  const itemsIn: any[] = Array.isArray(cg.items) ? cg.items : [];
  const items = itemsIn.map((it) => {
    if (it?.kind === "order_total_gte_eur") {
      return { kind: "order_total_gte", amount: Number(it.amount ?? 0) };
    }
    return it;
  });
  return { op, items } as ConditionsGroup;
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
      runScope: "per_order",
      conditions: { op: "AND", items: [] },
      actions: [{ type: "send_coupon", payload: {} }],
      cooldownDays: 30,
    },
  });

  // Single, unified useFieldArray for actions
  const {
    fields: actionFields,
    append: appendAction,
    remove: removeAction,
    update: updateAction,
    replace: replaceActions,
  } = useFieldArray({ control: form.control, name: "actions" });

  // Helper: set a nested payload field without remounting the whole row
  const setActionPayloadField = React.useCallback(
    (idx: number, field: string, value: unknown) => {
      form.setValue(`actions.${idx}.payload.${field}` as const, value as any, {
        shouldDirty: true,
        shouldTouch: true,
      });
    },
    [form]
  );

  // Normalize legacy defaults AND pick up payload.scope / cooldownDays if present.
  React.useEffect(() => {
    if (!defaultValues) return;
    const dv: any = defaultValues;

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

    const existingCooldown =
      Number(payload?.cooldownDays) && Number(payload?.cooldownDays) > 0
        ? Math.floor(Number(payload.cooldownDays))
        : 30;

    // Normalize legacy condition kind → new kind
    const normalizedConditions = normalizeConditionsGroup(payload.conditions) ?? { op: "AND", items: [] };

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
      conditions: normalizedConditions,
      actions,
      cooldownDays: existingCooldown,
    } as RuleFormValues);

    // Sync the field-array immediately after reset so UI renders values
    replaceActions(actions as any);
  }, [defaultValues, existingSingle]); // eslint-disable-line react-hooks/exhaustive-deps

  const disabled = form.formState.isSubmitting;

  // Watch specific fields
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
    cooldownDays: form.watch("cooldownDays"),
  };

  const allowedKinds = allowedKindsForEvent(currentEvent);

  // If user selects "customer_inactive", force per_customer and seed defaults
  React.useEffect(() => {
    if (currentEvent === "customer_inactive" && w.runScope !== "per_customer") {
      form.setValue("runScope", "per_customer", { shouldDirty: true });
    }
    if (currentEvent === "customer_inactive") {
      const hasDays =
        Array.isArray(w.conditions?.items) &&
        w.conditions.items.some((i: any) => i?.kind === "no_order_days_gte");
      if (!hasDays) {
        form.setValue(
          "conditions",
          { op: "AND", items: [{ kind: "no_order_days_gte", days: 30 }] } as any,
          { shouldDirty: true }
        );
      }
      if (!Number.isFinite(Number(w.cooldownDays)) || Number(w.cooldownDays) < 1) {
        form.setValue("cooldownDays", 30, { shouldDirty: true });
      }
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

    const payload: any = {
      templateSubject: values.templateSubject,
      templateMessage: values.templateMessage,
      conditions: values.conditions,
      actions: values.actions,
      scope: values.runScope,
    };

    if (values.event === "customer_inactive") {
      payload.cooldownDays =
        Number(values.cooldownDays) && Number(values.cooldownDays) > 0
          ? Math.floor(Number(values.cooldownDays))
          : 30;
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
      payload,
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

  // Keep updateAction only for structural changes (e.g., type switch),
  // but for keystrokes use setActionPayloadField to avoid remount/focus loss.
  const updateActionItem = (idx: number, patch: Partial<ActionItem>) => {
    const cur = (form.getValues(`actions.${idx}`) || {}) as ActionItem;
    updateAction(idx, { ...(cur as any), ...(patch as any) });
  };

  const addAction = () => appendAction({ type: "send_coupon", payload: {} } as any);

  const removeActionItem = (idx: number) => {
    if (mode === "create" && actionFields.length <= 1) return;
    removeAction(idx);
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
                <Hint text="Lower number runs earlier. Ties are broken by the newest rule." />
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
                <Hint text="Choose an order status or 'customer inactive'." />
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
                <Hint text="Keep a rule without running it by turning it off." />
              </div>
            </div>
          </div>
        </section>

        {/* Run scope (per order / per customer) */}
        <section className="grid gap-4 rounded-2xl border p-4 md:p-6">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Run scope</h2>
            <Hint text="Per order = once for each order. Per customer = only once ever for that customer." />
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
                    <Hint text="Runs once for each matching order." />
                  </div>
                  {currentEvent === "customer_inactive" && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Not available for “customer inactive”.
                    </p>
                  )}
                </div>
              </label>

              <label className="flex items-start gap-3 rounded-xl border p-3">
                <RadioGroupItem value="per_customer" id="scope-customer" disabled={disabled} />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Per customer</span>
                    <Hint text="Runs at most once per customer (unless the sweep repeats it by cooldown)." />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Tip: For re-engagement cycles, consider separate rules (e.g., 60/120 days).
                  </p>
                </div>
              </label>
            </RadioGroup>
          </div>

          {/* Repeat cadence for customer_inactive */}
          {currentEvent === "customer_inactive" && (
            <div className="grid gap-2 md:max-w-sm">
              <div className="flex items-center gap-2">
                <Label htmlFor="cooldownDays">Repeat every (days)</Label>
                <Hint text="After we send this rule to a customer, we’ll wait this many days before they can receive it again." />
              </div>
              <Input
                id="cooldownDays"
                type="number"
                min={1}
                step={1}
                value={
                  Number.isFinite(Number(w.cooldownDays)) && Number(w.cooldownDays) > 0
                    ? String(w.cooldownDays)
                    : "30"
                }
                onChange={(e) =>
                  form.setValue(
                    "cooldownDays",
                    Math.max(1, Math.floor(Number(e.target.value || 1))),
                    { shouldDirty: true }
                  )
                }
                disabled={disabled}
              />
              <p className="text-xs text-muted-foreground">
                Default is 30 days. The background sweep enforces this via a per-rule per-customer lock.
              </p>
            </div>
          )}
        </section>

        {/* Countries & Conditions */}
        <section className="grid gap-6 rounded-2xl border p-4 md:p-6">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Conditions</h2>
            <Hint text="Extra filters the order/customer must pass." />
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

        {/* Actions (data only) */}
        <section className="grid gap-4 rounded-2xl border p-4 md:p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">Actions</h2>
              <Hint text="Combine coupon and/or product recommendations, then reference them in the message body." />
            </div>
            <Button type="button" onClick={addAction} disabled={disabled}>
              + Add action
            </Button>
          </div>

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
                    <Hint text="Choose the kind of content this action contributes." />
                  </div>
                  <Select
                    value={(a as any).type ?? ""}
                    onValueChange={(v) =>
                      updateActionItem(idx, {
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
                      onClick={() => removeActionItem(idx)}
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
                      <Hint text="Pick a coupon valid for the rule’s countries. Use {coupon} in the body to show its code." />
                    </div>
                    <CouponSelect
                      value={((a as any).payload?.couponId ?? null) as any}
                      onChange={(id) => setActionPayloadField(idx, "couponId", id)}
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
                      <Hint text="Sets a multiplier on this order’s spending-based points. We keep the highest set by any rule." />
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
                        onChange={(e) => {
                          const raw = e.target.value;
                          setActionPayloadField(
                            idx,
                            "factor",
                            raw === "" ? undefined : Number(raw)
                          );
                        }}
                        disabled={disabled}
                        placeholder="e.g. 1.5"
                      />
                      <Input
                        placeholder="Optional description (internal)"
                        value={(a as any).payload?.description ?? ""}
                        onChange={(e) => setActionPayloadField(idx, "description", e.target.value)}
                        disabled={disabled}
                      />
                    </div>
                  </div>
                )}

                {(a as any).type === "award_points" && (
                  <div className="grid gap-4">
                    <div className="flex items-center gap-2">
                      <Label>Points</Label>
                      <Hint text="Immediately credits the buyer with a fixed number of affiliate points (1 decimal allowed)." />
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
                        onChange={(e) => {
                          const raw = e.target.value;
                          setActionPayloadField(
                            idx,
                            "points",
                            raw === "" ? undefined : Number(raw)
                          );
                        }}
                        disabled={disabled}
                        placeholder="e.g. 10 or 1.5"
                      />
                      <Input
                        placeholder="Optional description (internal)"
                        value={(a as any).payload?.description ?? ""}
                        onChange={(e) => setActionPayloadField(idx, "description", e.target.value)}
                        disabled={disabled}
                      />
                    </div>
                  </div>
                )}

                {(a as any).type === "product_recommendation" && (
                  <div className="grid gap-4">
                    <div className="flex items-center gap-2">
                      <Label>Products to recommend</Label>
                      <Hint text="Use {recommended_products} in the body to render them as a list." />
                    </div>
                    <ProductMulti
                      label="Products to recommend"
                      value={(Array.isArray((a as any).payload?.productIds) ? (a as any).payload.productIds : []) as string[]}
                      onChange={(ids) => setActionPayloadField(idx, "productIds", ids)}
                      disabled={disabled}
                      ruleCountries={w.countries}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </section>

        {/* Delivery — moved to sit ABOVE Message */}
        <section className="grid gap-6 rounded-2xl border p-4 md:p-6">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Delivery</h2>
            <Hint text="Email and/or Telegram." />
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label>Channels</Label>
            </div>
            <ChannelsPicker
              value={(w.channels as Channel[]) ?? []}
              onChange={(v) => form.setValue("channels", v, { shouldDirty: true })}
              disabled={disabled}
            />
          </div>
        </section>

        {/* Shared Message — at the end for clarity */}
        <section className="grid gap-6 rounded-2xl border p-4 md:p-6">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Message</h2>
            <Hint text="One message for all selected actions. Placeholders: {coupon}, {recommended_products}." />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label>Subject</Label>
              <Hint text="Subject for email notifications. Telegram ignores this." />
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
              <Hint text="Write your message with formatting. Use placeholders where needed." />
            </div>
            <ReactQuill
              theme="snow"
              value={w.templateMessage ?? ""}
              onChange={(html) => form.setValue("templateMessage", html, { shouldDirty: true })}
              modules={quillModules}
            />
            <p className="text-xs text-muted-foreground">
              Placeholders: <code>{`{coupon}`}</code>, <code>{`{recommended_products}`}</code>
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
