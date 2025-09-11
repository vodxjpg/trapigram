"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, Controller } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CountriesMulti, CurrencyMulti } from "./ConditionFields";
import EventsMulti, { EventKey } from "./EventsMulti";
import ActionsMulti, { CouponConfig, RecoConfig } from "./ActionsMulti";

const channelsEnum = z.enum(["email", "telegram", "in_app", "webhook"]);
const eventEnum = z.enum([
  "order_placed",
  "order_pending_payment",
  "order_paid",
  "order_completed",
  "order_cancelled",
  "order_refunded",
  "order_partially_paid",
  "order_shipped",
  "order_message",
  "ticket_created",
  "ticket_replied",
  "manual",
]);

// Base schema only to validate the "conditions" shared by multiple rules
const BaseSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  enabled: z.boolean().default(true),
  priority: z.coerce.number().int().min(0).default(100),
  countries: z.array(z.string()).default([]),
  orderCurrencyIn: z.array(z.enum(["USD", "EUR", "GBP"])).default([]),

  // multi-event UI (fan-out on create)
  events: z.array(eventEnum).min(1),

  // optional product condition (used in each action payload)
  onlyIfProductIdsAny: z.array(z.string()).optional(),
});

export type RuleFormValues = z.infer<typeof BaseSchema>;

export default function RuleForm({
  mode, // create | edit
  id,   // only used for edit
  defaultValues,
  existingSingle, // for edit mode: the existing rule row
}: {
  mode: "create" | "edit";
  id?: string;
  defaultValues?: Partial<RuleFormValues>;
  existingSingle?: {
    event: EventKey;
    action: "send_coupon" | "product_recommendation";
    channels: ("email" | "telegram" | "in_app" | "webhook")[];
    payload: any;
  };
}) {
  const router = useRouter();

  const form = useForm<RuleFormValues>({
    resolver: zodResolver(BaseSchema),
    defaultValues: {
      name: "",
      description: "",
      enabled: true,
      priority: 100,
      countries: [],
      orderCurrencyIn: [],
      events: ["order_paid"],
      onlyIfProductIdsAny: [],
      ...defaultValues,
    },
  });

  // Action states (each has own channels + payload)
  const [coupon, setCoupon] = React.useState<CouponConfig>(() => ({
    enabled: mode === "edit" ? existingSingle?.action === "send_coupon" : true,
    channels:
      (existingSingle?.action === "send_coupon" ? (existingSingle?.channels ?? ["email"]) : ["email"]) as any,
    couponId: existingSingle?.payload?.couponId ?? "",
    code: existingSingle?.payload?.code ?? "",
    templateSubject: existingSingle?.payload?.templateSubject ?? "",
    templateMessage: existingSingle?.payload?.templateMessage ?? "",
    url: existingSingle?.payload?.url ?? "",
  }));

  const [reco, setReco] = React.useState<RecoConfig>(() => ({
    enabled: mode === "edit" ? existingSingle?.action === "product_recommendation" : false,
    channels:
      (existingSingle?.action === "product_recommendation"
        ? (existingSingle?.channels ?? ["email"])
        : ["email"]) as any,
    productIds: existingSingle?.payload?.productIds ?? [],
    collectionId: existingSingle?.payload?.collectionId ?? "",
    templateSubject: existingSingle?.payload?.templateSubject ?? "",
    templateMessage: existingSingle?.payload?.templateMessage ?? "",
    url: existingSingle?.payload?.url ?? "",
  }));

  const disabled = form.formState.isSubmitting;

  async function createOneRule(evt: EventKey, action: "send_coupon" | "product_recommendation", payload: any, channels: string[]) {
    const body = {
      name: form.getValues("name"),
      description: form.getValues("description"),
      enabled: form.getValues("enabled"),
      priority: form.getValues("priority"),
      event: evt,
      countries: form.getValues("countries"),
      orderCurrencyIn: form.getValues("orderCurrencyIn"),
      action,
      channels,
      payload,
    };
    const res = await fetch("/api/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(t || "Failed creating rule");
    }
  }

  async function onSubmit(values: RuleFormValues) {
    if (mode === "edit" && id && existingSingle) {
      // Edit updates a single rule in place
      const action = existingSingle.action;
      const chosen = action === "send_coupon" ? coupon : reco;
      const payload =
        action === "send_coupon"
          ? {
              couponId: coupon.couponId || null,
              code: coupon.code || undefined,
              templateSubject: coupon.templateSubject || undefined,
              templateMessage: coupon.templateMessage || undefined,
              url: coupon.url || null,
              onlyIfProductIdsAny: values.onlyIfProductIdsAny?.length ? values.onlyIfProductIdsAny : undefined,
            }
          : {
              productIds: reco.productIds?.length ? reco.productIds : undefined,
              collectionId: reco.collectionId || undefined,
              templateSubject: reco.templateSubject || undefined,
              templateMessage: reco.templateMessage || undefined,
              url: reco.url || null,
              onlyIfProductIdsAny: values.onlyIfProductIdsAny?.length ? values.onlyIfProductIdsAny : undefined,
            };

      const res = await fetch(`/api/rules/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          description: values.description,
          enabled: values.enabled,
          priority: values.priority,
          countries: values.countries,
          orderCurrencyIn: values.orderCurrencyIn,
          channels: chosen.channels,
          payload,
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        alert(t || "Failed to save");
        return;
      }
      router.push("/conditional-rules");
      router.refresh();
      return;
    }

    // CREATE mode → fan-out: (events × enabled actions)
    const jobs: Promise<any>[] = [];
    const enabledActions: Array<"send_coupon" | "product_recommendation"> = [];
    if (coupon.enabled) enabledActions.push("send_coupon");
    if (reco.enabled) enabledActions.push("product_recommendation");
    if (!enabledActions.length) {
      alert("Please enable at least one action (Send coupon or Recommend product).");
      return;
    }

    for (const evt of values.events) {
      for (const a of enabledActions) {
        if (a === "send_coupon") {
          const payload = {
            couponId: coupon.couponId || null,
            code: coupon.code || undefined,
            templateSubject: coupon.templateSubject || undefined,
            templateMessage: coupon.templateMessage || undefined,
            url: coupon.url || null,
            onlyIfProductIdsAny: values.onlyIfProductIdsAny?.length ? values.onlyIfProductIdsAny : undefined,
          };
          jobs.push(createOneRule(evt, "send_coupon", payload, coupon.channels));
        } else {
          const payload = {
            productIds: reco.productIds?.length ? reco.productIds : undefined,
            collectionId: reco.collectionId || undefined,
            templateSubject: reco.templateSubject || undefined,
            templateMessage: reco.templateMessage || undefined,
            url: reco.url || null,
            onlyIfProductIdsAny: values.onlyIfProductIdsAny?.length ? values.onlyIfProductIdsAny : undefined,
          };
          jobs.push(createOneRule(evt, "product_recommendation", payload, reco.channels));
        }
      }
    }

    try {
      await Promise.all(jobs);
      router.push("/conditional-rules");
      router.refresh();
    } catch (e: any) {
      alert(e?.message || String(e));
    }
  }

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
            <Input id="priority" type="number" min={0} {...form.register("priority", { valueAsNumber: true })} disabled={disabled} />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea id="description" rows={3} {...form.register("description")} disabled={disabled} />
        </div>

        <div className="flex items-center gap-2">
          <Switch
            id="enabled"
            checked={form.watch("enabled")}
            onCheckedChange={(v) => form.setValue("enabled", v)}
            disabled={disabled}
          />
          <Label htmlFor="enabled">Enabled</Label>
        </div>
      </section>

      {/* Triggers */}
      <section className="grid gap-4 rounded-2xl border p-4 md:p-6">
        <h2 className="text-lg font-semibold">Trigger events</h2>
        <Controller
          control={form.control}
          name="events"
          render={({ field }) => (
            <EventsMulti value={field.value as EventKey[]} onChange={field.onChange} disabled={disabled || mode === "edit"} />
          )}
        />
        {mode === "edit" && (
          <p className="text-xs text-muted-foreground">Editing an existing rule only affects its single trigger event.</p>
        )}
      </section>

      {/* Conditions */}
      <section className="grid gap-4 rounded-2xl border p-4 md:p-6">
        <h2 className="text-lg font-semibold">Conditions</h2>
        <CountriesMulti control={form.control} name="countries" disabled={disabled} />
        <CurrencyMulti control={form.control} name="orderCurrencyIn" disabled={disabled} />
        <div className="space-y-2">
          <Label>Only if order contains ANY of these product IDs (comma)</Label>
          <Input
            placeholder="prod_a,prod_b"
            value={(form.watch("onlyIfProductIdsAny") ?? []).join(",")}
            onChange={(e) =>
              form.setValue(
                "onlyIfProductIdsAny",
                e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
              )
            }
            disabled={disabled}
          />
        </div>
      </section>

      {/* Actions */}
      <section className="grid gap-6 rounded-2xl border p-4 md:p-6">
        <h2 className="text-lg font-semibold">Actions</h2>
        <ActionsMulti coupon={coupon} setCoupon={setCoupon} reco={reco} setReco={setReco} disabled={disabled} />
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
