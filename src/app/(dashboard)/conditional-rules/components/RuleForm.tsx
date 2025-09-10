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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import ChannelsPicker, { Channel } from "./ChannelPicker";
import { CountriesMulti, CurrencyMulti } from "./ConditionFields";

const channelsEnum = z.enum(["email", "telegram", "in_app", "webhook"]);

export const RuleSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional().nullable(),
  enabled: z.boolean().default(true),
  priority: z.coerce.number().int().min(0).default(100),

  event: z.enum([
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
  ]),

  countries: z.array(z.string()).default([]),
  orderCurrencyIn: z.array(z.enum(["USD", "EUR", "GBP"])).default([]),

  action: z.enum(["send_coupon", "product_recommendation"]),
  channels: z.array(channelsEnum).min(1, "Pick at least one channel"),
  payload: z.object({
    couponId: z.string().optional().nullable(),
    code: z.string().optional(),
    templateSubject: z.string().optional(),
    templateMessage: z.string().optional(),
    url: z.string().url().optional().nullable(),

    productIds: z.array(z.string()).optional(),
    collectionId: z.string().optional(),
  }),
});

export type RuleFormValues = z.infer<typeof RuleSchema>;

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
      orderCurrencyIn: [],
      action: "send_coupon",
      channels: ["email"],
      payload: {},
      ...defaultValues,
    },
  });

  const disabled = form.formState.isSubmitting;
  const watch = form.watch();

  async function onSubmit(values: RuleFormValues) {
    const url = mode === "create" ? "/api/rules" : `/api/rules/${id}`;
    const method = mode === "create" ? "POST" : "PATCH";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body?.error || "Failed to save rule");
      return;
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
            <Label>Event</Label>
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
        <CurrencyMulti control={form.control} name="orderCurrencyIn" disabled={disabled} />
      </section>

      <section className="grid gap-6 rounded-2xl border p-4 md:p-6">
        <h2 className="text-lg font-semibold">Action</h2>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Action type</Label>
            <Controller
              control={form.control}
              name="action"
              render={({ field }) => (
                <Select disabled={disabled} onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select action" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="send_coupon">Send coupon</SelectItem>
                    <SelectItem value="product_recommendation">Recommend product</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="space-y-2">
            <Label>Channels</Label>
            <ChannelsPicker
              value={form.watch("channels") as Channel[]}
              onChange={(v) => form.setValue("channels", v)}
              disabled={disabled}
            />
          </div>
        </div>

        {watch.action === "send_coupon" && (
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="couponId">Coupon ID (or leave empty and use code)</Label>
              <Input
                id="couponId"
                value={(form.watch("payload") as any)?.couponId || ""}
                onChange={(e) =>
                  form.setValue("payload", {
                    ...form.getValues("payload"),
                    couponId: e.target.value,
                  })
                }
                disabled={disabled}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="code">Fallback Code</Label>
              <Input
                id="code"
                placeholder="SUMMER25"
                value={(form.watch("payload") as any)?.code || ""}
                onChange={(e) =>
                  form.setValue("payload", {
                    ...form.getValues("payload"),
                    code: e.target.value,
                  })
                }
                disabled={disabled}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="templateSubject">Subject</Label>
              <Input
                id="templateSubject"
                value={(form.watch("payload") as any)?.templateSubject || ""}
                onChange={(e) =>
                  form.setValue("payload", {
                    ...form.getValues("payload"),
                    templateSubject: e.target.value,
                  })
                }
                disabled={disabled}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="templateMessage">Message (HTML allowed)</Label>
              <Textarea
                id="templateMessage"
                rows={5}
                value={(form.watch("payload") as any)?.templateMessage || ""}
                onChange={(e) =>
                  form.setValue("payload", {
                    ...form.getValues("payload"),
                    templateMessage: e.target.value,
                  })
                }
                disabled={disabled}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="url">URL (optional)</Label>
              <Input
                id="url"
                value={(form.watch("payload") as any)?.url || ""}
                onChange={(e) =>
                  form.setValue("payload", {
                    ...form.getValues("payload"),
                    url: e.target.value,
                  })
                }
                disabled={disabled}
              />
            </div>
          </div>
        )}

        {watch.action === "product_recommendation" && (
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="productIds">Product IDs (comma-separated)</Label>
              <Input
                id="productIds"
                placeholder="prod_1,prod_2"
                value={((form.watch("payload") as any)?.productIds || []).join(",")}
                onChange={(e) =>
                  form.setValue("payload", {
                    ...form.getValues("payload"),
                    productIds: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                disabled={disabled}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="collectionId">Collection ID (optional)</Label>
              <Input
                id="collectionId"
                value={(form.watch("payload") as any)?.collectionId || ""}
                onChange={(e) =>
                  form.setValue("payload", {
                    ...form.getValues("payload"),
                    collectionId: e.target.value,
                  })
                }
                disabled={disabled}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="templateSubject2">Subject</Label>
              <Input
                id="templateSubject2"
                value={(form.watch("payload") as any)?.templateSubject || ""}
                onChange={(e) =>
                  form.setValue("payload", {
                    ...form.getValues("payload"),
                    templateSubject: e.target.value,
                  })
                }
                disabled={disabled}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="templateMessage2">Message (HTML allowed)</Label>
              <Textarea
                id="templateMessage2"
                rows={5}
                value={(form.watch("payload") as any)?.templateMessage || ""}
                onChange={(e) =>
                  form.setValue("payload", {
                    ...form.getValues("payload"),
                    templateMessage: e.target.value,
                  })
                }
                disabled={disabled}
              />
            </div>
          </div>
        )}
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
