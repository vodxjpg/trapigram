// src/app/(dashboard)/coupons/coupon-form.tsx
"use client";

import { useState, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
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
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import Select from "react-select";
import { Switch } from "@/components/ui/switch";
import countriesLib from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";
import { getCountries } from "libphonenumber-js";
import ReactCountryFlag from "react-country-flag";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */
countriesLib.registerLocale(enLocale);
const allCountries = getCountries().map((c) => ({
  code: c,
  name: countriesLib.getName(c, "en") || c,
}));

const pad = (n: number) => n.toString().padStart(2, "0");

// Returns local YYYY-MM-DDTHH:MM:SS for “now”
const nowLocal = () => {
  const d = new Date();
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
};

// Returns local YYYY-MM-DDTHH:MM:SS for “now + 1s” (for expiration min)
const nowPlus1sLocal = () => {
  const d = new Date(Date.now() + 1000);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
};

// Convert ISO → local input string
const isoToLocalInput = (iso: string) => {
  const d = new Date(iso);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
};

// Ensure a datetime-local string has time; if only a date is provided, append a time.
const withTime = (dateOrDateTime: string, hh = 0, mm = 0, ss = 0) => {
  if (!dateOrDateTime) return dateOrDateTime;
  if (dateOrDateTime.includes("T")) return dateOrDateTime; // already has time
  const d = new Date(dateOrDateTime);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hh)}:${pad(mm)}:${pad(ss)}`;
};

/* -------------------------------------------------------------------------- */
/* Zod schema                                                                 */
/* -------------------------------------------------------------------------- */
const schema = z.object({
  name: z.string().min(1, "Name is required"),
  code: z.string().min(1, "Code is required"),
  description: z.string().min(1, "Description is required"),
  // NEW: stackable boolean
  stackable: z.boolean().default(false),
  discountType: z.enum(["fixed", "percentage"]),
  discountAmount: z.coerce.number().min(0.01, "Amount must be greater than 0"),
  usageLimit: z.coerce.number().int().min(0).default(0),
  expendingLimit: z.coerce.number().int().min(0).default(0),
  expendingMinimum: z.coerce.number().int().min(0).default(0),
  countries: z
    .array(z.string().length(2))
    .min(1, "At least one country is required"),
  visibility: z.boolean().default(true),
  hasExpiration: z.boolean().default(false),
  startDate: z
    .string()
    .refine((v) => !!v, { message: "Start date is required" }),
  expirationDate: z
    .string()
    .nullable()
    .refine((v) => !v || new Date(v) > new Date(), {
      message: "Expiration must be in the future",
    })
    .optional(),
  limitPerUser: z.coerce.number().int().min(0).default(0),
});
type Values = z.infer<typeof schema>;
type Props = { couponData?: Values | null; isEditing?: boolean };

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */
export function CouponForm({ couponData, isEditing = false }: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const minStartLocal = useMemo(nowLocal, []);
  const minExpireLocal = useMemo(nowPlus1sLocal, []);

  /* ---------------------------- form setup -------------------------------- */
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      code: "",
      description: "",
      // NEW default
      stackable: false,
      discountType: "fixed",
      discountAmount: 0,
      usageLimit: 0,
      expendingLimit: 0,
      expendingMinimum: 0,
      countries: [],
      visibility: true,
      hasExpiration: false,
      startDate: minStartLocal,
      expirationDate: null,
      limitPerUser: 0,
    },
  });

  /* ---------------------------- countries -------------------------------- */
  const [countryOptions, setCountryOptions] = useState<
    { value: string; label: string }[]
  >([]);
  useEffect(() => {
    fetch("/api/organizations/countries", {
      headers: {
        "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "",
      },
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch organization countries");
        return res.json();
      })
      .then((data) => {
        const list: string[] = Array.isArray(data.countries)
          ? data.countries
          : JSON.parse(data.countries || "[]");
        setCountryOptions(
          list.map((c) => ({
            value: c,
            label: allCountries.find((co) => co.code === c)?.name || c,
          }))
        );
      })
      .catch((err) =>
        toast.error(err.message || "Failed to load organization countries")
      );
  }, []);

  /* ---------------------------- preload edit ----------------------------- */
  useEffect(() => {
    if (isEditing && couponData) {
      const countries = Array.isArray(couponData.countries)
        ? couponData.countries
        : JSON.parse(couponData.countries as unknown as string);

      form.reset({
        ...couponData,
        countries,
        // ensure boolean for stackable if missing
        stackable: Boolean((couponData as any).stackable),
        hasExpiration: Boolean(couponData.expirationDate),
        startDate: couponData.startDate
          ? isoToLocalInput(couponData.startDate)
          : minStartLocal,
        expirationDate: couponData.expirationDate ?? null,
      });
    }
  }, [couponData, isEditing, form, minStartLocal]);

  /* ---------------------------- sync switch ------------------------------- */
  const expVal = form.watch("expirationDate");
  useEffect(() => {
    const on = Boolean(expVal);
    if (form.getValues("hasExpiration") !== on) {
      form.setValue("hasExpiration", on, {
        shouldValidate: false,
        shouldDirty: true,
      });
    }
  }, [expVal, form]);

  /* ---------------------------- submit ----------------------------------- */
  const onSubmit = async (vals: Values) => {
    setSubmitting(true);
    try {
      const url =
        isEditing && (couponData as any)?.id
          ? `/api/coupons/${(couponData as any).id}`
          : "/api/coupons";

      const payload = {
        ...vals, // includes `stackable`
        startDate: new Date(vals.startDate).toISOString(),
        expirationDate: vals.expirationDate
          ? new Date(vals.expirationDate).toISOString()
          : null,
      };

      const res = await fetch(url, {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg =
          typeof data?.error === "string"
            ? data.error
            : Array.isArray(data?.error)
              ? data.error.map((e: any) => e.message).join("\n")
              : "Request failed";
        throw new Error(msg);
      }
      toast.success(isEditing ? "Coupon updated" : "Coupon created");
      router.push("/coupons");
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  /* ---------------------------- render ----------------------------------- */
  return (
    <Card className="w-full mx-auto">
      <CardContent className="pt-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Name & Code */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                { name: "name", label: "Name *", placeholder: "Coupon Name" },
                { name: "code", label: "Code *", placeholder: "Coupon Code" },
              ].map(({ name, label, placeholder }) => (
                <FormField
                  key={name}
                  control={form.control}
                  name={name as keyof Values}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{label}</FormLabel>
                      <FormControl>
                        <Input placeholder={placeholder} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
            </div>

            {/* Description & Countries */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description *</FormLabel>
                    <FormControl>
                      <Input placeholder="Coupon Description" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
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
                          field.value.includes(o.value)
                        )}
                        onChange={(opts: any) =>
                          field.onChange(opts.map((o: any) => o.value))
                        }
                        formatOptionLabel={(o: any) => (
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
            </div>

            {/* Stackable & Discount Type + Amount */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
              {/* LEFT column: Stackable (left) + Discount Type (right) */}
              <div className="flex items-center gap-8">
                <FormField
                  control={form.control}
                  name="stackable"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Stackable</FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-3">
                          <span className={!field.value ? "font-semibold" : ""}>
                            No
                          </span>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                          <span className={field.value ? "font-semibold" : ""}>
                            Yes
                          </span>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="discountType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Discount Type</FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-3">
                          <span
                            className={
                              field.value === "fixed" ? "font-semibold" : ""
                            }
                          >
                            Fixed
                          </span>
                          <Switch
                            checked={field.value === "percentage"}
                            onCheckedChange={(c) =>
                              field.onChange(c ? "percentage" : "fixed")
                            }
                          />
                          <span
                            className={
                              field.value === "percentage"
                                ? "font-semibold"
                                : ""
                            }
                          >
                            %
                          </span>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* RIGHT column: Amount */}
              <FormField
                control={form.control}
                name="discountAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Amount{" "}
                      {form.watch("discountType") === "percentage"
                        ? "(%)"
                        : "(currency)"}
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Numeric Limits */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {[
                { name: "usageLimit", label: "Usage Limit" },
                { name: "expendingMinimum", label: "Expending Minimum" },
                { name: "expendingLimit", label: "Expending Limit" },
                { name: "limitPerUser", label: "Limit Per User" },
              ].map(({ name, label }) => (
                <FormField
                  key={name}
                  control={form.control}
                  name={name as keyof Values}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{label}</FormLabel>
                      <FormControl>
                        <Input type="number" placeholder="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
            </div>

            {/* Has Expiration & Visibility */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="visibility"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Visibility</FormLabel>
                    <FormControl>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                        <span>{field.value ? "Visible" : "Hidden"}</span>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="hasExpiration"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Has Expiration?</FormLabel>
                    <FormControl>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={field.value}
                          onCheckedChange={(checked) => {
                            field.onChange(checked);
                            if (!checked) {
                              form.setValue("expirationDate", null, {
                                shouldValidate: true,
                                shouldDirty: true,
                              });
                            }
                          }}
                        />
                        <span>{field.value ? "Yes" : "No"}</span>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Start Date & Expiration Date */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Start Date */}
              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start Date &amp; Time</FormLabel>
                    <FormControl>
                      <Input
                        type="datetime-local"
                        step={1}
                        value={field.value}
                        onChange={(e) => {
                          const raw = e.target.value;
                          // If user picked only a day, keep current local time
                          if (raw && !raw.includes("T")) {
                            const now = new Date();
                            field.onChange(
                              withTime(
                                raw,
                                now.getHours(),
                                now.getMinutes(),
                                now.getSeconds()
                              )
                            );
                          } else {
                            field.onChange(raw);
                          }
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Expiration Date */}
              {form.watch("hasExpiration") && (
                <FormField
                  control={form.control}
                  name="expirationDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Expiration Date &amp; Time</FormLabel>
                      <FormControl>
                        <Input
                          type="datetime-local"
                          step={1}
                          min={minExpireLocal}
                          value={
                            field.value ? isoToLocalInput(field.value) : ""
                          }
                          onChange={(e) => {
                            const raw = e.target.value;
                            if (!raw) {
                              field.onChange(null);
                              return;
                            }
                            // If user picked only a day, default to end-of-day local time
                            const local = raw.includes("T")
                              ? raw
                              : withTime(raw, 23, 59, 59);
                            field.onChange(new Date(local).toISOString());
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>

            {/* Submit Buttons */}
            <div className="flex justify-center gap-4 mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push("/coupons")}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting
                  ? isEditing
                    ? "Updating…"
                    : "Creating…"
                  : isEditing
                    ? "Update Coupon"
                    : "Create Coupon"}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
