"use client";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { X } from "lucide-react";

const hours = Array.from({ length: 24 }, (_, i) => i);

const ConditionKinds = [
  { value: "customer_inactive_for_days", label: "Hasn’t ordered for… days" },
  { value: "purchased_product_in_list", label: "Purchased product is one of…" },
  { value: "purchase_time_in_window", label: "Purchase time is between…" },
] as const;

const ChannelOptions = ["email", "telegram"] as const;

const actionKindOptions = [
  { value: "send_message_with_coupon", label: "Send message with coupon" },
  { value: "recommend_product", label: "Recommend a product" },
  { value: "grant_affiliate_points", label: "Grant affiliate points" },
  { value: "multiply_affiliate_points_for_order", label: "Multiply affiliate points (this order)" },
  { value: "queue_next_order_points", label: "Grant extra points on NEXT order" },
] as const;

const schema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  isEnabled: z.boolean().default(true),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  conditions: z.array(z.any()).default([]),
  actions: z.array(z.any()).min(1),
});
type Values = z.infer<typeof schema>;

export function RuleForm({ rule }: { rule?: any }) {
  const router = useRouter();

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      description: "",
      isEnabled: true,
      startDate: null,
      endDate: null,
      conditions: [],
      actions: [],
    },
  });

  // Local builders keep the UI snappy and structured
  const [conditions, setConditions] = useState<any[]>([]);
  const [actions, setActions] = useState<any[]>([]);

  useEffect(() => {
    if (rule) {
      // filter out 'always' from existing data so it doesn't appear in the UI
      const incomingConds = Array.isArray(rule.conditions) ? rule.conditions.filter((c: any) => c?.kind !== "always") : [];
      form.reset({
        name: rule.name ?? "",
        description: rule.description ?? "",
        isEnabled: !!rule.isEnabled,
        startDate: rule.startDate ? new Date(rule.startDate).toISOString().slice(0, 16) : null,
        endDate: rule.endDate ? new Date(rule.endDate).toISOString().slice(0, 16) : null,
        conditions: incomingConds,
        actions: Array.isArray(rule.actions) ? rule.actions : [],
      });
      setConditions(incomingConds);
      setActions(Array.isArray(rule.actions) ? rule.actions : []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rule]);

  // ——— Condition builder ———
  const addCondition = (kind: string) => {
    if (kind === "customer_inactive_for_days") setConditions(prev => [...prev, { kind, days: 30 }]);
    if (kind === "purchased_product_in_list") setConditions(prev => [...prev, { kind, productIds: [] }]);
    if (kind === "purchase_time_in_window") setConditions(prev => [...prev, { kind, fromHour: 0, toHour: 23 }]); // inclusive enforced in engine
  };
  const removeCondition = (idx: number) => setConditions(prev => prev.filter((_, i) => i !== idx));

  // ——— Action builder ———
  const addAction = (kind: string) => {
    if (kind === "send_message_with_coupon") {
      setActions(prev => [
        ...prev,
        {
          kind,
          subject: "",
          htmlTemplate: "",
          channels: ["email"],
          coupon: {
            name: "",
            description: "",
            discountType: "fixed",
            discountAmount: 0,
            usageLimit: 1,
            expendingLimit: 1,
            expendingMinimum: 0,
            countries: [],
            visibility: true,
            stackable: false,
            startDateISO: null,
            expirationDateISO: null,
          },
        },
      ]);
    } else if (kind === "recommend_product") {
      setActions(prev => [
        ...prev,
        {
          kind,
          subject: "",
          htmlTemplate: "",
          channels: ["email"],
          productId: "",
        },
      ]);
    } else if (kind === "grant_affiliate_points") {
      setActions(prev => [
        ...prev,
        {
          kind,
          points: 0,
          action: "promo_bonus",
          description: "",
        },
      ]);
    } else if (kind === "multiply_affiliate_points_for_order") {
      setActions(prev => [
        ...prev,
        {
          kind,
          multiplier: 2,
          action: "promo_multiplier",
          description: "",
        },
      ]);
    } else if (kind === "queue_next_order_points") {
      setActions(prev => [
        ...prev,
        {
          kind,
          points: 100,
          expiresAtISO: null,
          description: "Come back bonus",
        },
      ]);
    }
  };
  const removeAction = (idx: number) => setActions(prev => prev.filter((_, i) => i !== idx));

  const onSubmit = async (vals: Values) => {
    try {
      const payload = {
        ...vals,
        event: "order_paid" as const, // locked
        scope: "base" as const,       // locked
        conditions,
        actions,
        startDate: vals.startDate || null,
        endDate: vals.endDate || null,
      };
      const url = rule ? `/api/magic-rules/${rule.id}` : "/api/magic-rules";
      const res = await fetch(url, {
        method: rule ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Save failed");
      toast.success(rule ? "Rule updated" : "Rule created");
      router.push("/magic-rules");
      router.refresh();
    } catch (e: any) {
      toast.error(e.message || "Save failed");
    }
  };

  return (
    <Card className="w-full mx-auto">
      <CardContent className="pt-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            {/* Locked context */}
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">Event: order_paid</Badge>
              <Badge variant="outline">Scope: base</Badge>
              <Badge variant="secondary">Stops after first match</Badge>
              <Badge variant="secondary">Once per order</Badge>
            </div>

            {/* Basics */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                name="name"
                control={form.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                name="isEnabled"
                control={form.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Enabled</FormLabel>
                    <FormControl>
                      <div className="flex items-center gap-3">
                        <span>No</span>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                        <span>Yes</span>
                      </div>
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            <FormField
              name="description"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Schedule window */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                name="startDate"
                control={form.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start Date</FormLabel>
                    <FormControl>
                      <Input
                        type="datetime-local"
                        value={field.value ?? ""}
                        onChange={(e) => field.onChange(e.target.value || null)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                name="endDate"
                control={form.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>End Date</FormLabel>
                    <FormControl>
                      <Input
                        type="datetime-local"
                        value={field.value ?? ""}
                        onChange={(e) => field.onChange(e.target.value || null)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Conditions */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">When should this run?</h3>
                <div className="flex items-center gap-2">
                  <Select onValueChange={(v) => addCondition(v)}>
                    <SelectTrigger className="w-[260px]">
                      <SelectValue placeholder="Add condition…" />
                    </SelectTrigger>
                    <SelectContent>
                      {ConditionKinds.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                {conditions.map((c, idx) => (
                  <div key={idx} className="rounded-lg border p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="font-medium">
                        {c.kind === "customer_inactive_for_days" && "Hasn’t ordered for… days"}
                        {c.kind === "purchased_product_in_list" && "Purchased product is one of"}
                        {c.kind === "purchase_time_in_window" && "Purchase time is between"}
                        {!["customer_inactive_for_days","purchased_product_in_list","purchase_time_in_window"].includes(c.kind) && c.kind}
                      </div>
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeCondition(idx)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>

                    {c.kind === "customer_inactive_for_days" && (
                      <div className="space-y-2">
                        <FormLabel>Days of inactivity</FormLabel>
                        <Input
                          type="number"
                          min={1}
                          value={c.days ?? 30}
                          onChange={(e) =>
                            setConditions((prev) =>
                              prev.map((p, i) =>
                                i === idx ? { ...p, days: Math.max(1, Number(e.target.value || 1)) } : p,
                              ),
                            )
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          Rule matches when the last order was at least this many days ago.
                        </p>
                      </div>
                    )}

                    {c.kind === "purchased_product_in_list" && (
                      <div className="space-y-2">
                        <FormLabel>Product IDs (comma separated)</FormLabel>
                        <Input
                          placeholder="prod_123, prod_456"
                          value={(c.productIds || []).join(", ")}
                          onChange={(e) =>
                            setConditions((prev) =>
                              prev.map((p, i) =>
                                i === idx
                                  ? {
                                      ...p,
                                      productIds: e.target.value
                                        .split(",")
                                        .map((s) => s.trim())
                                        .filter(Boolean),
                                    }
                                  : p,
                              ),
                            )
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          Tip: paste IDs for now; product search can be wired later.
                        </p>
                      </div>
                    )}

                    {c.kind === "purchase_time_in_window" && (
                      <div className="grid grid-cols-2 gap-3 items-end">
                        <div>
                          <FormLabel>From hour</FormLabel>
                          <Select
                            value={String(c.fromHour)}
                            onValueChange={(v) =>
                              setConditions((prev) =>
                                prev.map((p, i) => (i === idx ? { ...p, fromHour: Number(v) } : p)),
                              )
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {hours.map((h) => (
                                <SelectItem key={h} value={String(h)}>
                                  {h}:00
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <FormLabel>To hour</FormLabel>
                          <Select
                            value={String(c.toHour)}
                            onValueChange={(v) =>
                              setConditions((prev) =>
                                prev.map((p, i) => (i === idx ? { ...p, toHour: Number(v) } : p)),
                              )
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {hours.map((h) => (
                                <SelectItem key={h} value={String(h)}>
                                  {h}:00
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <p className="col-span-2 text-xs text-muted-foreground">
                          Hours are <strong>inclusive</strong> (e.g. 09:00 and 17:00 both count).
                        </p>
                      </div>
                    )}
                  </div>
                ))}
                {conditions.length === 0 && (
                  <p className="text-sm text-muted-foreground">Add at least one condition or leave empty to target all paid orders.</p>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">What should happen?</h3>
                <Select onValueChange={(v) => addAction(v)}>
                  <SelectTrigger className="w-[260px]">
                    <SelectValue placeholder="Add action…" />
                  </SelectTrigger>
                  <SelectContent>
                    {actionKindOptions.map((a) => (
                      <SelectItem key={a.value} value={a.value}>
                        {a.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-4">
                {actions.map((a, idx) => (
                  <div key={idx} className="rounded-lg border p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="font-medium">
                        {actionKindOptions.find((k) => k.value === a.kind)?.label || a.kind}
                      </div>
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeAction(idx)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>

                    {["send_message_with_coupon", "recommend_product"].includes(a.kind) && (
                      <>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <FormLabel>Subject</FormLabel>
                            <Input
                              value={a.subject}
                              onChange={(e) =>
                                setActions((prev) =>
                                  prev.map((p, i) => (i === idx ? { ...p, subject: e.target.value } : p)),
                                )
                              }
                            />
                          </div>
                          <div>
                            <FormLabel>Channel</FormLabel>
                            <Select
                              value={a.channels?.[0] || "email"}
                              onValueChange={(v) =>
                                setActions((prev) =>
                                  prev.map((p, i) => (i === idx ? { ...p, channels: [v] } : p)),
                                )
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {ChannelOptions.map((c) => (
                                  <SelectItem key={c} value={c}>
                                    {c}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div>
                          <FormLabel>Message (HTML allowed)</FormLabel>
                          <Textarea
                            rows={5}
                            placeholder="Hi {client_id}, your code is {coupon_code}…"
                            value={a.htmlTemplate}
                            onChange={(e) =>
                              setActions((prev) =>
                                prev.map((p, i) => (i === idx ? { ...p, htmlTemplate: e.target.value } : p)),
                              )
                            }
                          />
                        </div>
                      </>
                    )}

                    {a.kind === "send_message_with_coupon" && (
                      <div className="rounded-md border p-3 space-y-3">
                        <div className="font-medium">Coupon</div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <FormLabel>Name</FormLabel>
                            <Input
                              value={a.coupon?.name ?? ""}
                              onChange={(e) =>
                                setActions((prev) =>
                                  prev.map((p, i) =>
                                    i === idx ? { ...p, coupon: { ...p.coupon, name: e.target.value } } : p,
                                  ),
                                )
                              }
                            />
                          </div>
                          <div>
                            <FormLabel>Discount type</FormLabel>
                            <Select
                              value={a.coupon?.discountType ?? "fixed"}
                              onValueChange={(v) =>
                                setActions((prev) =>
                                  prev.map((p, i) =>
                                    i === idx ? { ...p, coupon: { ...p.coupon, discountType: v } } : p,
                                  ),
                                )
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="fixed">Fixed</SelectItem>
                                <SelectItem value="percentage">Percentage</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <FormLabel>Discount amount</FormLabel>
                            <Input
                              type="number"
                              value={a.coupon?.discountAmount ?? 0}
                              onChange={(e) =>
                                setActions((prev) =>
                                  prev.map((p, i) =>
                                    i === idx
                                      ? {
                                          ...p,
                                          coupon: {
                                            ...p.coupon,
                                            discountAmount: Number(e.target.value || 0),
                                          },
                                        }
                                      : p,
                                  ),
                                )
                              }
                            />
                          </div>
                          <div>
                            <FormLabel>Usage limit</FormLabel>
                            <Input
                              type="number"
                              value={a.coupon?.usageLimit ?? 1}
                              onChange={(e) =>
                                setActions((prev) =>
                                  prev.map((p, i) =>
                                    i === idx
                                      ? { ...p, coupon: { ...p.coupon, usageLimit: Number(e.target.value || 0) } }
                                      : p,
                                  ),
                                )
                              }
                            />
                          </div>
                          <div>
                            <FormLabel>Expending limit</FormLabel>
                            <Input
                              type="number"
                              value={a.coupon?.expendingLimit ?? 1}
                              onChange={(e) =>
                                setActions((prev) =>
                                  prev.map((p, i) =>
                                    i === idx
                                      ? { ...p, coupon: { ...p.coupon, expendingLimit: Number(e.target.value || 0) } }
                                      : p,
                                  ),
                                )
                              }
                            />
                          </div>
                          <div>
                            <FormLabel>Minimum spend</FormLabel>
                            <Input
                              type="number"
                              value={a.coupon?.expendingMinimum ?? 0}
                              onChange={(e) =>
                                setActions((prev) =>
                                  prev.map((p, i) =>
                                    i === idx
                                      ? { ...p, coupon: { ...p.coupon, expendingMinimum: Number(e.target.value || 0) } }
                                      : p,
                                  ),
                                )
                              }
                            />
                          </div>
                          <div className="md:col-span-2">
                            <FormLabel>Countries (comma separated ISO: GB,IE,ES)</FormLabel>
                            <Input
                              value={(a.coupon?.countries ?? []).join(", ")}
                              onChange={(e) =>
                                setActions((prev) =>
                                  prev.map((p, i) =>
                                    i === idx
                                      ? {
                                          ...p,
                                          coupon: {
                                            ...p.coupon,
                                            countries: e.target.value
                                              .split(",")
                                              .map((s) => s.trim())
                                              .filter(Boolean),
                                          },
                                        }
                                      : p,
                                  ),
                                )
                              }
                            />
                          </div>
                          <div className="flex items-center gap-3">
                            <FormLabel>Visible</FormLabel>
                            <Switch
                              checked={!!a.coupon?.visibility}
                              onCheckedChange={(v) =>
                                setActions((prev) =>
                                  prev.map((p, i) =>
                                    i === idx ? { ...p, coupon: { ...p.coupon, visibility: v } } : p,
                                  ),
                                )
                              }
                            />
                          </div>
                          <div className="flex items-center gap-3">
                            <FormLabel>Stackable</FormLabel>
                            <Switch
                              checked={!!a.coupon?.stackable}
                              onCheckedChange={(v) =>
                                setActions((prev) =>
                                  prev.map((p, i) =>
                                    i === idx ? { ...p, coupon: { ...p.coupon, stackable: v } } : p,
                                  ),
                                )
                              }
                            />
                          </div>
                          <div>
                            <FormLabel>Coupon start</FormLabel>
                            <Input
                              type="datetime-local"
                              value={a.coupon?.startDateISO ?? ""}
                              onChange={(e) =>
                                setActions((prev) =>
                                  prev.map((p, i) =>
                                    i === idx
                                      ? { ...p, coupon: { ...p.coupon, startDateISO: e.target.value || null } }
                                      : p,
                                  ),
                                )
                              }
                            />
                          </div>
                          <div>
                            <FormLabel>Coupon expires</FormLabel>
                            <Input
                              type="datetime-local"
                              value={a.coupon?.expirationDateISO ?? ""}
                              onChange={(e) =>
                                setActions((prev) =>
                                  prev.map((p, i) =>
                                    i === idx
                                      ? { ...p, coupon: { ...p.coupon, expirationDateISO: e.target.value || null } }
                                      : p,
                                  ),
                                )
                              }
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {a.kind === "recommend_product" && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <FormLabel>Product ID</FormLabel>
                          <Input
                            value={a.productId}
                            onChange={(e) =>
                              setActions((prev) =>
                                prev.map((p, i) => (i === idx ? { ...p, productId: e.target.value } : p)),
                              )
                            }
                          />
                        </div>
                      </div>
                    )}

                    {a.kind === "grant_affiliate_points" && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                          <FormLabel>Points (+/-)</FormLabel>
                          <Input
                            type="number"
                            value={a.points}
                            onChange={(e) =>
                              setActions((prev) =>
                                prev.map((p, i) => (i === idx ? { ...p, points: Number(e.target.value || 0) } : p)),
                              )
                            }
                          />
                        </div>
                        <div>
                          <FormLabel>Action</FormLabel>
                          <Input
                            value={a.action}
                            onChange={(e) =>
                              setActions((prev) =>
                                prev.map((p, i) => (i === idx ? { ...p, action: e.target.value } : p)),
                              )
                            }
                          />
                        </div>
                        <div>
                          <FormLabel>Description</FormLabel>
                          <Input
                            value={a.description ?? ""}
                            onChange={(e) =>
                              setActions((prev) =>
                                prev.map((p, i) => (i === idx ? { ...p, description: e.target.value } : p)),
                              )
                            }
                          />
                        </div>
                      </div>
                    )}

                    {a.kind === "multiply_affiliate_points_for_order" && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                          <FormLabel>Multiplier (e.g. 2 = double)</FormLabel>
                          <Input
                            type="number"
                            step="0.1"
                            value={a.multiplier}
                            onChange={(e) =>
                              setActions((prev) =>
                                prev.map((p, i) => (i === idx ? { ...p, multiplier: Number(e.target.value || 1) } : p)),
                              )
                            }
                          />
                        </div>
                        <div>
                          <FormLabel>Action</FormLabel>
                          <Input
                            value={a.action ?? "promo_multiplier"}
                            onChange={(e) =>
                              setActions((prev) =>
                                prev.map((p, i) => (i === idx ? { ...p, action: e.target.value } : p)),
                              )
                            }
                          />
                        </div>
                        <div>
                          <FormLabel>Description</FormLabel>
                          <Input
                            value={a.description ?? ""}
                            onChange={(e) =>
                              setActions((prev) =>
                                prev.map((p, i) => (i === idx ? { ...p, description: e.target.value } : p)),
                              )
                            }
                          />
                        </div>
                      </div>
                    )}

                    {a.kind === "queue_next_order_points" && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                          <FormLabel>Points</FormLabel>
                          <Input
                            type="number"
                            value={a.points}
                            onChange={(e) =>
                              setActions(prev =>
                                prev.map((p, i) =>
                                  i === idx ? ({ ...p, points: Math.max(1, Number(e.target.value || 1)) }) : p
                                )
                              )
                            }
                          />
                        </div>
                        <div>
                          <FormLabel>Expires (optional)</FormLabel>
                          <Input
                            type="datetime-local"
                            value={a.expiresAtISO ?? ""}
                            onChange={(e) =>
                              setActions(prev =>
                                prev.map((p, i) =>
                                  i === idx ? ({ ...p, expiresAtISO: e.target.value || null }) : p
                                )
                              )
                            }
                          />
                        </div>
                        <div>
                          <FormLabel>Description</FormLabel>
                          <Input
                            value={a.description ?? ""}
                            onChange={(e) =>
                              setActions(prev =>
                                prev.map((p, i) =>
                                  i === idx ? ({ ...p, description: e.target.value }) : p
                                )
                              )
                            }
                          />
                        </div>
                        <p className="md:col-span-3 text-xs text-muted-foreground">
                          Queues a one-time points bonus that will be automatically applied to the customer’s next paid order (before rules run).
                        </p>
                      </div>
                    )}
                  </div>
                ))}
                {actions.length === 0 && (
                  <p className="text-sm text-muted-foreground">Add at least one action.</p>
                )}
              </div>
            </div>

            <div className="flex justify-center gap-4">
              <Button type="button" variant="outline" onClick={() => router.push("/magic-rules")}>
                Cancel
              </Button>
              <Button type="submit">{rule ? "Update" : "Create"}</Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
