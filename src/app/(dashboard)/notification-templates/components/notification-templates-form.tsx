// src/app/(dashboard)/notification-templates/components/notification-templates-form.tsx
"use client";

import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Select from "react-select";
import countriesLib from "i18n-iso-countries";
import en from "i18n-iso-countries/langs/en.json";
import { getCountries } from "libphonenumber-js";
import ReactCountryFlag from "react-country-flag";

/* ──────────────────────────────────────────────────────────────
 * Constants must stay in sync with backend NotificationType union
 * ────────────────────────────────────────────────────────────── */
const NOTIF_TYPES = [
  "order_placed",
  "order_paid",
  "order_completed",
  "order_cancelled",
  "order_refunded",
  "order_partially_paid",
  "ticket_created",
  "ticket_replied",
  "order_message",
] as const;

countriesLib.registerLocale(en);
const allCountries = getCountries().map((c) => ({
  code: c,
  name: countriesLib.getName(c, "en") || c,
}));

const ReactQuill = dynamic(() => import("react-quill-new"), { ssr: false });
import "react-quill-new/dist/quill.snow.css";

/* -------------------- schema -------------------- */
const schema = z.object({
  type: z.enum(NOTIF_TYPES, { errorMap: () => ({ message: "Select a type" }) }),
  role: z.enum(["admin", "user"]),
  countries: z
    .array(z.string().length(2))
    .min(1, "Select at least one country"),
  subject: z.string().min(1, "Subject is required"),
  message: z.string().min(1, "Body is required"),
});

type FormValues = z.infer<typeof schema>;

type Props = { id?: string; initial?: any | null };

/* -------------------- component -------------------- */
export function NotificationTemplateForm({ id, initial }: Props) {
  const router = useRouter();
  const isEditing = !!id;

  /* ---------- RHF setup ---------- */
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      type: "order_placed",
      role: "user",
      countries: [],
      subject: "",
      message: "",
    },
  });

  /* ---------- state ---------- */
  const [submitting, setSubmitting] = useState(false);
  const [countryOptions, setCountryOptions] = useState<{ value: string; label: string }[]>([]);

  /* ---------- preload (edit) ---------- */
  useEffect(() => {
    if (!initial) return;
    const countries =
      Array.isArray(initial.countries)
        ? initial.countries
        : JSON.parse(initial.countries || "[]");
    form.reset({ ...initial, countries });
  }, [initial, form]);

  /* ---------- fetch organisation countries ---------- */
  useEffect(() => {
    fetch("/api/organizations/countries", {
      headers: {
        "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "",
      },
    })
      .then((r) => {
        if (!r.ok) throw new Error("Failed to fetch organization countries");
        return r.json();
      })
      .then((data) => {
        const list: string[] = Array.isArray(data.countries)
          ? data.countries
          : JSON.parse(data.countries || "[]");

        setCountryOptions(
          list.map((c) => ({
            value: c,
            label: allCountries.find((co) => co.code === c)?.name || c,
          })),
        );
      })
      .catch((err) => toast.error((err as Error).message));
  }, []);

  /* ---------- submit ---------- */
  const onSubmit = async (vals: FormValues) => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/notification-templates${id ? `/${id}` : ""}`, {
        method: id ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "",
        },
        body: JSON.stringify(vals),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Request failed");
      toast.success(isEditing ? "Template updated" : "Template created");
      router.push("/notification-templates");
      router.refresh();
    } catch (err: any) {
      toast.error(err.message ?? "Error");
    } finally {
      setSubmitting(false);
    }
  };

  /* ---------- quill ---------- */
  const quillModules = {
    toolbar: [
      [{ header: [1, 2, false] }],
      ["bold", "italic", "underline"],
      [{ list: "ordered" }, { list: "bullet" }],
      ["clean"],
    ],
  };

  /* ---------- render ---------- */
  return (
    <Card className="w-full mx-auto border rounded-lg shadow-sm">
      <CardContent className="p-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Type */}
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notification Type *</FormLabel>
                  <FormControl>
                    <select {...field} className="border rounded p-2">
                      {NOTIF_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Role */}
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Recipient Role *</FormLabel>
                  <FormControl>
                    <select {...field} className="border rounded p-2">
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                    </select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Countries */}
            <FormField
              control={form.control}
              name="countries"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Countries *</FormLabel>
                  <FormControl>
                    <Select
                      isMulti
                      options={countryOptions}
                      placeholder="Select country(s)"
                      value={countryOptions.filter((o) => field.value.includes(o.value))}
                      onChange={(opts) => field.onChange((opts as any[]).map((o) => o.value))}
                      formatOptionLabel={(o: { value: string; label: string }) => (
                        <div className="flex items-center gap-2">
                          <ReactCountryFlag countryCode={o.value} svg style={{ width: 20 }} />
                          <span>{o.label}</span>
                        </div>
                      )}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Subject */}
            <FormField
              control={form.control}
              name="subject"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email Subject *</FormLabel>
                  <FormControl>
                    <Input placeholder="Subject line" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Body */}
            <FormField
              control={form.control}
              name="message"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Available placeholders:&nbsp;
                  </FormLabel>
                  <div>
                    <span className="text-xs">{`{product_list}`} - Output order's product list </span>,&nbsp;<br></br>
                    <span className="text-xs">{`{order_number}`} - Output order's number</span>,&nbsp;<br></br>
                    <span className="text-xs">{`{order_date}`} - Output order's date</span>,&nbsp;<br></br>
                    <span className="text-xs">{`{order_shipping_method}`} - Output order's shipping method</span>,&nbsp;<br></br>
                    <span className="text-xs">{`{tracking_number}`} - Output order's tracking number</span>,&nbsp;<br></br>
                    <span className="text-xs">{`{shipping_company}`} - Output order's shipping company</span>,&nbsp;<br></br>
                    <span className="text-xs">{`{expected_amt}`} - Output order's crypto expected amount (works with Coinslick)</span>,&nbsp;<br></br>
                    <span className="text-xs">{`{received_amt}`} - Output order's crypto received amount (works with Coinslick)</span>,&nbsp;<br></br>
                    <span className="text-xs">{`{pending_amt}`} - Output order's crypto pending amount (works with Coinslick)</span>,&nbsp;<br></br>
                    <span className="text-xs">{`{asset}`} - Output order's crypto asset (works with Coinslick)</span>,&nbsp;<br></br>
                    <span className="text-xs">{`{ticket_number}`} - Output support ticket number</span>
                  </div>
                  <FormControl>
                    <ReactQuill theme="snow" value={field.value} onChange={field.onChange} modules={quillModules} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Buttons */}
            <div className="flex justify-center gap-4 pt-4">
              <Button type="button" variant="outline" onClick={() => router.back()}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting
                  ? isEditing
                    ? "Updating…"
                    : "Creating…"
                  : isEditing
                    ? "Update"
                    : "Create"}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
