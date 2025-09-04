"use client";
import { useEffect } from "react";
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
import { toast } from "sonner";

const schema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  event: z.enum([
    "order_paid","order_completed","order_cancelled",
    "order_refunded","order_underpaid","order_open","order_status_changed"
  ]),
  scope: z.enum(["base","supplier","both"]).default("both"),
  priority: z.coerce.number().int().min(0).default(100),
  runOncePerOrder: z.boolean().default(true),
  stopOnMatch: z.boolean().default(false),
  isEnabled: z.boolean().default(true),
  // JSON textareas for now (keep UI small)
  conditions: z.string().transform((s) => (s?.trim() ? JSON.parse(s) : [])),
  actions: z.string().transform((s) => (s?.trim() ? JSON.parse(s) : [])),
});
type Values = z.infer<typeof schema>;
export function RuleForm({ rule }: { rule?: any }) {
  const router = useRouter();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "", description: "",
      event: "order_paid", scope: "both",
      priority: 100, runOncePerOrder: true, stopOnMatch: false, isEnabled: true,
      conditions: "[]", actions: "[]",
    },
  });

  useEffect(() => {
    if (rule) {
      form.reset({
        ...rule,
        conditions: JSON.stringify(rule.conditions ?? [], null, 2),
        actions: JSON.stringify(rule.actions ?? [], null, 2),
      });
    }
  }, [rule, form]);

  const onSubmit = async (vals: Values) => {
    try {
      const url = rule ? `/api/magic-rules/${rule.id}` : "/api/magic-rules";
      const res = await fetch(url, {
        method: rule ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vals),
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
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField name="name" control={form.control} render={({ field }) => (
                <FormItem><FormLabel>Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )}/>
              <FormField name="priority" control={form.control} render={({ field }) => (
                <FormItem><FormLabel>Priority</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
              )}/>
            </div>

            <FormField name="description" control={form.control} render={({ field }) => (
              <FormItem><FormLabel>Description</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
            )}/>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FormField name="event" control={form.control} render={({ field }) => (
                <FormItem>
                  <FormLabel>Event</FormLabel>
                  <FormControl>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger><SelectValue placeholder="Event" /></SelectTrigger>
                      <SelectContent>
                        {["order_paid","order_completed","order_cancelled","order_refunded","order_underpaid","order_open","order_status_changed"].map((e) =>
                          <SelectItem key={e} value={e}>{e}</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}/>
              <FormField name="scope" control={form.control} render={({ field }) => (
                <FormItem>
                  <FormLabel>Scope</FormLabel>
                  <FormControl>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger><SelectValue placeholder="Scope" /></SelectTrigger>
                      <SelectContent>
                        {["both","base","supplier"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}/>
              <div className="grid grid-cols-3 gap-6 items-end">
                <FormField name="runOncePerOrder" control={form.control} render={({ field }) => (
                  <FormItem><FormLabel>Once / Order</FormLabel><FormControl>
                    <div className="flex items-center gap-3"><span>No</span><Switch checked={field.value} onCheckedChange={field.onChange}/><span>Yes</span></div>
                  </FormControl></FormItem>
                )}/>
                <FormField name="stopOnMatch" control={form.control} render={({ field }) => (
                  <FormItem><FormLabel>Stop on Match</FormLabel><FormControl>
                    <div className="flex items-center gap-3"><span>No</span><Switch checked={field.value} onCheckedChange={field.onChange}/><span>Yes</span></div>
                  </FormControl></FormItem>
                )}/>
                <FormField name="isEnabled" control={form.control} render={({ field }) => (
                  <FormItem><FormLabel>Enabled</FormLabel><FormControl>
                    <div className="flex items-center gap-3"><span>No</span><Switch checked={field.value} onCheckedChange={field.onChange}/><span>Yes</span></div>
                  </FormControl></FormItem>
                )}/>
              </div>
            </div>

            <FormField name="conditions" control={form.control} render={({ field }) => (
              <FormItem>
                <FormLabel>Conditions (JSON)</FormLabel>
                <FormControl><Textarea rows={8} {...field} placeholder='[{"field":"country","op":"in","value":["GB","IE"]}]' /></FormControl>
                <FormMessage />
              </FormItem>
            )}/>
            <FormField name="actions" control={form.control} render={({ field }) => (
              <FormItem>
                <FormLabel>Actions (JSON)</FormLabel>
                <FormControl><Textarea rows={8} {...field} placeholder='[{"type":"notify","channel":"telegram","audience":"admin_only"}]' /></FormControl>
                <FormMessage />
              </FormItem>
            )}/>

            <div className="flex justify-center gap-4">
              <Button type="button" variant="outline" onClick={() => router.push("/magic-rules")}>Cancel</Button>
              <Button type="submit">{rule ? "Update" : "Create"}</Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
