// src/app/(dashboard)/announcements/announcements-form.tsx
"use client";

import { useState, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import dynamic from "next/dynamic"; // Added for dynamic import
import Select from "react-select";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarIcon } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Switch } from "@/components/ui/switch";

// ─────────────── dynamic Quill ───────────────
const ReactQuill = dynamic(() => import("react-quill-new"), { ssr: false });
import("react-quill-new/dist/quill.snow.css");

// ─────────────── countries util ───────────────
import countriesLib from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";
import { getCountries } from "libphonenumber-js";
import ReactCountryFlag from "react-country-flag";

countriesLib.registerLocale(enLocale);
const allCountries = getCountries().map((c) => ({
  code: c,
  name: countriesLib.getName(c, "en") || c,
}));

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */
const pad = (n: number) => n.toString().padStart(2, "0");
const nowPlus1sLocal = () => {
  const d = new Date(Date.now() + 1000);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
};
const isoToLocalInput = (iso: string) => {
  const d = new Date(iso);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
};

/* -------------------------------------------------------------------------- */
/* Zod schema                                                                 */
/* -------------------------------------------------------------------------- */
const announcementFormSchema = z.object({
  title: z.string().min(1, "Title is required"),
  content: z.string().min(1, "Content is required"),
  deliveryScheduled: z.boolean(),
  deliveryDate: z
    .string()
    .nullable()
    .refine((v) => !v || new Date(v) > new Date(), {
      message: "Delivery must be in the future",
    })
    .optional(),
  countries: z.array(z.string()).min(1, "Select at least one country")
});

type AnnouncementFormValues = z.infer<typeof announcementFormSchema>;
type Props = { announcementData?: AnnouncementFormValues | null; isEditing?: boolean };

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */
export function AnnouncementForm({ announcementData, isEditing = false }: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const minAttr = useMemo(nowPlus1sLocal, []);

  /* ---------------------------- react‑hook‑form -------------------------- */
  const form = useForm<AnnouncementFormValues>({
    resolver: zodResolver(announcementFormSchema),
    defaultValues: {
      title: "",
      content: "",
      deliveryScheduled: false,
      deliveryDate: null,
      countries: [],
      status: "draft",
    },
  });

  /* ---------------------------- load countries --------------------------- */
  const [countryOptions, setCountryOptions] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/organizations/countries", {
          headers: { "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "" },
        });
        if (!res.ok) throw new Error("Failed to fetch organization countries");
        const data = await res.json();
        const list: string[] = Array.isArray(data.countries)
          ? data.countries
          : JSON.parse(data.countries || "[]");
        setCountryOptions(
          list.map((c) => ({
            value: c,
            label: allCountries.find((co) => co.code === c)?.name || c,
          })),
        );
      } catch (err: any) {
        toast.error(err.message || "Failed to load organization countries");
      }
    })();
  }, []);

  /* ---------------------------- preload if editing ----------------------- */
  useEffect(() => {
    if (isEditing && announcementData) {
      const countries = Array.isArray(announcementData.countries)
        ? announcementData.countries
        : JSON.parse(announcementData.countries as unknown as string);

      form.reset({
        ...announcementData,
        countries,
      });
    }
  }, [announcementData, isEditing, form]);

  /* ---------------------------- submit ----------------------------------- */
  const onSubmit = async (vals: AnnouncementFormValues) => {
    setSubmitting(true);
    try {
      const url = isEditing
        ? `/api/announcements/${announcementData?.id}`
        : "/api/announcements";
      const res = await fetch(url, {
        method: isEditing ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "",
        },
        body: JSON.stringify({
          title: vals.title,
          content: vals.content,
          deliveryDate: vals.deliveryScheduled ? vals.deliveryDate : null,
          countries: JSON.stringify(vals.countries),
          status: vals.status,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Request failed");
      toast.success(isEditing ? "Announcement updated" : "Announcement created");
      router.push("/announcements");
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  /* ---------------------------- Quill config ----------------------------- */
  const modules = {
    toolbar: [
      [{ header: [1, 2, false] }],
      ["bold", "italic", "underline", "strike", "blockquote"],
      [{ list: "ordered" }, { list: "bullet" }, { indent: "-1" }, { indent: "+1" }],
      ["link", "image"],
      ["clean"],
    ],
  };
  const formats = [
    "header",
    "bold",
    "italic",
    "underline",
    "strike",
    "blockquote",
    "list",
    "indent",
    "link",
    "image",
  ];

  /* ---------------------------- render ----------------------------------- */
  return (
    <Card className="w-full mx-auto border rounded-lg shadow-sm">
      <CardContent className="p-6 pt-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Title */}
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title *</FormLabel>
                  <FormControl>
                    <Input placeholder="Announcement Title" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Content */}
            <FormField
              control={form.control}
              name="content"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Content *</FormLabel>
                  <FormControl>
                    <ReactQuill
                      theme="snow"
                      value={field.value}
                      onChange={field.onChange}
                      modules={modules}
                      formats={formats}
                    />
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
                      onChange={(opts: any) => field.onChange(opts.map((o: any) => o.value))}
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

            {/* Schedule delivery */}
            <FormField
              control={form.control}
              name="deliveryScheduled"
              render={({ field }) => (
                <FormItem className="flex items-center space-x-2">
                  <FormLabel>Schedule Delivery?</FormLabel>
                  <FormControl>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        className="mr-2"
                      />
                      <span>{field.value ? "Yes" : "No"}</span>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Date‑time input (only visible if scheduled) */}
            {form.watch("deliveryScheduled") && (
              <FormField
                control={form.control}
                name="deliveryDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Delivery Date &amp; Time</FormLabel>
                    <FormControl>
                      <Input
                        type="datetime-local"
                        step={1}
                        min={minAttr}
                        value={field.value ? isoToLocalInput(field.value) : ""}
                        onChange={(e) =>
                          field.onChange(e.target.value ? new Date(e.target.value).toISOString() : null)
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* Hidden status (default draft) */}
            <input type="hidden" {...form.register("status")} />

            {/* Buttons */}
            <div className="flex justify-center gap-4 mt-6">
              <Button type="button" variant="outline" onClick={() => router.push("/announcements")}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting
                  ? isEditing
                    ? "Updating…"
                    : "Creating…"
                  : isEditing
                  ? "Update Announcement"
                  : "Create Announcement"}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
