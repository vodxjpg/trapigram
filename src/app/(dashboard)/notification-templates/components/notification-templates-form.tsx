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
  FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select as ShadSelect,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Select from "react-select";
import countriesLib from "i18n-iso-countries";
import en from "i18n-iso-countries/langs/en.json";
import { getCountries } from "libphonenumber-js";
import ReactCountryFlag from "react-country-flag";
import { Check, Copy } from "lucide-react";

/* ──────────────────────────────────────────────────────────────
 * Constants must stay in sync with backend NotificationType union
 * ────────────────────────────────────────────────────────────── */
const NOTIF_TYPES = [
  "order_placed",
  "order_pending_payment",
  "order_paid",
  "order_completed",
  "order_cancelled",
  "order_refunded",
  "order_partially_paid",
  "order_shipped",          // ✅ present in API; add here for parity
  "ticket_created",
  "ticket_replied",
  "order_message",
] as const;

type NotifType = (typeof NOTIF_TYPES)[number];

/** Natural language labels for types */
const TYPE_LABEL: Record<NotifType, string> = {
  order_placed: "New orders",
  order_pending_payment: "Pending payments",
  order_partially_paid: "Partially paid orders",
  order_paid: "Paid orders",
  order_completed: "Completed orders",
  order_cancelled: "Cancelled orders",
  order_refunded: "Refunded orders",
  order_shipped: "Shipped orders",
  order_message: "Order messages",
  ticket_created: "Ticket created",
  ticket_replied: "Ticket replied",
};

/** Colors aligned with orders table statuses */
const TYPE_BADGE_BG: Record<NotifType, string> = {
  order_placed: "bg-blue-500",
  order_pending_payment: "bg-yellow-500",
  order_partially_paid: "bg-orange-500",
  order_paid: "bg-green-500",
  order_completed: "bg-purple-500",
  order_cancelled: "bg-red-500",
  order_refunded: "bg-red-500",
  order_shipped: "bg-blue-500",
  order_message: "bg-slate-500",
  ticket_created: "bg-indigo-500",
  ticket_replied: "bg-indigo-500",
};

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

/* -------------------- small UI bits -------------------- */
function ColorDot({ className }: { className: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-2.5 w-2.5 rounded-full ${className}`}
    />
  );
}

function TypeBadge({ type }: { type: NotifType }) {
  return (
    <span
      className={[
        "inline-flex items-center gap-2 rounded-full px-2.5 py-0.5 text-xs font-medium text-white",
        TYPE_BADGE_BG[type] ?? "bg-gray-500",
      ].join(" ")}
    >
      {TYPE_LABEL[type] ?? type.replace(/_/g, " ")}
    </span>
  );
}

function CopyChip({
  token,
  label,
}: {
  token: string;
  label: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      toast.success(`Copied ${token}`);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error("Unable to copy");
    }
  };
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent"
            aria-label={`Copy ${label}`}
          >
            <code className="text-xs">{token}</code>
            {copied ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent>Click to copy {label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

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
  const [countryOptions, setCountryOptions] = useState<
    { value: string; label: string }[]
  >([]);

  /* ---------- preload (edit) ---------- */
  useEffect(() => {
    if (!initial) return;
    const countries = Array.isArray(initial.countries)
      ? initial.countries
      : JSON.parse(initial.countries || "[]");
    form.reset({ ...initial, countries });
  }, [initial, form]);

  /* ---------- fetch organisation countries ---------- */
  useEffect(() => {
    fetch("/api/organizations/countries", {
      headers: {
        "x-internal-secret":
          process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "",
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
      const res = await fetch(
        `/api/notification-templates${id ? `/${id}` : ""}`,
        {
          method: id ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-secret":
              process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "",
          },
          body: JSON.stringify(vals),
        },
      );
      if (!res.ok)
        throw new Error((await res.json()).error || "Request failed");
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
  const quillModules = useMemo(
    () => ({
      toolbar: [
        [{ header: [1, 2, false] }],
        ["bold", "italic", "underline"],
        [{ list: "ordered" }, { list: "bullet" }],
        ["clean"],
      ],
    }),
    [],
  );

  /* ---------- placeholders (copy chips) ---------- */
  const PLACEHOLDERS: { token: string; label: string; desc: string }[] = [
    { token: "{product_list}", label: "Product list", desc: "Order items" },
    { token: "{order_number}", label: "Order number", desc: "Order code" },
    { token: "{order_date}", label: "Order date", desc: "Placed at" },
    {
      token: "{order_shipping_method}",
      label: "Shipping method",
      desc: "Carrier/method",
    },
    {
      token: "{tracking_number}",
      label: "Tracking number",
      desc: "Includes a link",
    },
    {
      token: "{shipping_company}",
      label: "Shipping company",
      desc: "Logistics company",
    },
    {
      token: "{expected_amt}",
      label: "Crypto expected",
      desc: "Coinslick",
    },
    { token: "{received_amt}", label: "Crypto received", desc: "Coinslick" },
    { token: "{pending_amt}", label: "Crypto pending", desc: "Coinslick" },
    { token: "{asset}", label: "Crypto asset", desc: "Coinslick" },
    { token: "{ticket_number}", label: "Ticket number", desc: "Support" },
    { token: "{ticket_content}", label: "Ticket content", desc: "Support" },
  ];

  /* ---------- render ---------- */
  return (
    <Card className="w-full mx-auto border rounded-lg shadow-sm">
      <CardContent className="p-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Type (natural language + color) */}
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => {
                const selected = field.value as NotifType;
                const badgeClass = TYPE_BADGE_BG[selected] ?? "bg-gray-500";
                const label = TYPE_LABEL[selected] ?? selected?.replace(/_/g, " ");
                return (
                  <FormItem>
                    <FormLabel>Notification Type *</FormLabel>
                    <div className="flex items-center gap-3">
                      {/* Live color/label preview */}
                      <TypeBadge type={selected || "order_placed"} />
                      <FormControl>
                        <ShadSelect
                          value={field.value}
                          onValueChange={field.onChange}
                        >
                          <SelectTrigger className="w-[280px]">
                            <div className="flex items-center gap-2">
                              <ColorDot className={badgeClass} />
                              <SelectValue placeholder="Choose a type" />
                            </div>
                          </SelectTrigger>
                          <SelectContent>
                            {NOTIF_TYPES.map((t) => (
                              <SelectItem key={t} value={t}>
                                {TYPE_LABEL[t] ?? t.replace(/_/g, " ")}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </ShadSelect>
                      </FormControl>
                    </div>
                    <FormDescription>
                      Types use the same colors as the orders table for quick scanning.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                );
              }}
            />

            {/* Role */}
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Recipient Role *</FormLabel>
                  <FormControl>
                    <ShadSelect
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <SelectTrigger className="w-[280px]">
                        <SelectValue placeholder="Select role" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="user">User</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </ShadSelect>
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
                      value={countryOptions.filter((o) =>
                        field.value.includes(o.value),
                      )}
                      onChange={(opts) =>
                        field.onChange((opts as any[]).map((o) => o.value))
                      }
                      formatOptionLabel={(o: { value: string; label: string }) => (
                        <div className="flex items-center gap-2">
                          <ReactCountryFlag
                            countryCode={o.value}
                            svg
                            style={{ width: 20 }}
                          />
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

            {/* Body + copyable placeholders */}
            <FormField
              control={form.control}
              name="message"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Body *</FormLabel>

                  {/* Copy chips */}
                  <div className="mb-2">
                    <div className="mb-1 text-sm text-muted-foreground">
                      Available placeholders (click to copy):
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {PLACEHOLDERS.map((p) => (
                        <CopyChip key={p.token} token={p.token} label={p.label} />
                      ))}
                    </div>
                    <div className="mt-2 text-[11px] text-muted-foreground">
                      Note: In e-mails, <code>{`{product_list}`}</code> is hidden for privacy;
                      the order details page and Telegram message include items.
                    </div>
                  </div>

                  <FormControl>
                    <ReactQuill
                      theme="snow"
                      value={field.value}
                      onChange={field.onChange}
                      modules={quillModules}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Buttons */}
            <div className="flex justify-center gap-4 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.back()}
              >
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
