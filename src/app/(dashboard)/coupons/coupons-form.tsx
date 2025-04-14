"use client";

import { useState, useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar as CalendarIcon } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

// ---------- Countries Setup ----------
import countriesLib from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";
import { getCountries } from "libphonenumber-js";
import ReactCountryFlag from "react-country-flag";

countriesLib.registerLocale(enLocale);
const allCountries = getCountries().map((code) => ({
  code,
  name: countriesLib.getName(code, "en") || code,
}));

// ---------- Coupon Schema ----------
const couponFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  code: z.string().min(1, "Code is required"),
  description: z.string().min(1, "Description is required"),
  usageLimit: z.coerce
    .number()
    .int()
    .min(0, "Usage limit must be 0 or greater")
    .default(0),
  expendingLimit: z.coerce
    .number()
    .int()
    .min(0, "Expending limit must be 0 or greater")
    .default(0),
  organizationIds: z
    .array(z.string())
    .min(1, "Select at least one organization"),
  countries: z
    .array(z.string().length(2))
    .min(1, "At least one country is required"),
  visibility: z.boolean().default(true),
  hasExpiration: z.boolean().default(false),
  expirationDate: z.string().nullable().optional(),
  limitPerUser: z.coerce
    .number()
    .int()
    .min(0, "Limit per user must be 0 or greater")
    .default(0),
});

type Organization = {
  id: string;
  name: string;
  countries: string[];
};

type CouponFormValues = z.infer<typeof couponFormSchema>;

type CouponFormProps = {
  couponData?: CouponFormValues | null;
  isEditing?: boolean;
};

export function CouponForm({ couponData, isEditing = false }: CouponFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");
  const [date, setDate] = useState<Date | null>(null);
  const [openDatePicker, setOpenDatePicker] = useState(false);

  const form = useForm<CouponFormValues>({
    resolver: zodResolver(couponFormSchema),
    defaultValues: {
      name: "",
      code: "",
      description: "",
      usageLimit: 0,
      expendingLimit: 0,
      countries: [],
      visibility: true,
      hasExpiration: false,
      expirationDate: null,
      limitPerUser: 0,
    },
  });

  useEffect(() => {
    if (isEditing && couponData) {
      // Ensure countries is an array.
      const countriesValue = Array.isArray(couponData.countries)
        ? couponData.countries
        : typeof couponData.countries === "string"
          ? JSON.parse(couponData.countries)
          : [];
      form.reset({
        ...couponData,
        countries: countriesValue,
      });
      if (couponData.expirationDate) {
        setDate(new Date(couponData.expirationDate));
      } else {
        setDate(null);
      }
    } else {
      form.reset({
        name: "",
        code: "",
        description: "",
        usageLimit: 0,
        expendingLimit: 0,
        countries: [],
        visibility: true,
        hasExpiration: false,
        expirationDate: null,
        limitPerUser: 0,
      });
      setDate(null);
    }
  }, [couponData, form, isEditing]);

  async function onSubmit(values: CouponFormValues) {
    setIsSubmitting(true);
    try {
      const url = isEditing ? `/api/coupons/${couponData?.id}` : "/api/coupons";
      const method = isEditing ? "PATCH" : "POST";
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.error ||
            `Failed to ${isEditing ? "update" : "create"} coupon`
        );
      }
      toast.success(
        isEditing
          ? "Coupon updated successfully"
          : "Coupon created successfully"
      );
      router.push("/coupons");
      router.refresh();
    } catch (error: any) {
      console.error(
        `Error ${isEditing ? "updating" : "creating"} coupon:`,
        error
      );
      toast.error(
        error.message || `Failed to ${isEditing ? "update" : "create"} coupon`
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const addCountry = (code: string) => {
    const current = form.getValues("countries");
    if (!current.includes(code)) {
      form.setValue("countries", [...current, code]);
    }
    setCountrySearch("");
  };

  const removeCountry = (code: string) => {
    const current = form.getValues("countries");
    form.setValue(
      "countries",
      current.filter((c) => c !== code)
    );
  };

  const filteredCountries = allCountries.filter(
    (c) =>
      c.name.toLowerCase().includes(countrySearch.toLowerCase()) ||
      c.code.toLowerCase().includes(countrySearch.toLowerCase())
  );

  return (
    <Card className="w-full mx-auto">
      <CardContent className="pt-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Row 1: Name and Code */}
              <div>
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name *</FormLabel>
                      <FormControl>
                        <Input placeholder="Coupon Name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div>
                <FormField
                  control={form.control}
                  name="code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Code *</FormLabel>
                      <FormControl>
                        <Input placeholder="Coupon Code" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Row 2: Description (span both columns) */}
              <div className="md:col-span-2">
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
              </div>

              {/* Row 3: Usage Limit and Expending Limit */}
              <div>
                <FormField
                  control={form.control}
                  name="usageLimit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Usage Limit</FormLabel>
                      <FormControl>
                        <Input type="number" placeholder="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div>
                <FormField
                  control={form.control}
                  name="expendingLimit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Expending Limit</FormLabel>
                      <FormControl>
                        <Input type="number" placeholder="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Row 4: Countries (span both columns) */}
              <div className="md:col-span-2">
                <FormField
                  control={form.control}
                  name="countries"
                  render={() => (
                    <FormItem>
                      <FormLabel>Countries *</FormLabel>
                      <div className="mb-2">
                        <Input
                          placeholder="Search country..."
                          value={countrySearch}
                          onChange={(e) => setCountrySearch(e.target.value)}
                        />
                        {countrySearch && filteredCountries.length > 0 && (
                          <div className="border mt-1 p-2 max-h-36 overflow-y-auto bg-white">
                            {filteredCountries.map((country) => (
                              <div
                                key={country.code}
                                className="flex items-center gap-2 p-1 hover:bg-gray-100 cursor-pointer"
                                onClick={() => addCountry(country.code)}
                              >
                                <ReactCountryFlag
                                  countryCode={country.code}
                                  svg
                                  className="inline-block mr-2"
                                />
                                <span>
                                  {country.name} ({country.code})
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {form.watch("countries").map((code: string) => {
                          const country = allCountries.find(
                            (c) => c.code === code
                          );
                          if (!country) return null;
                          return (
                            <div
                              key={code}
                              className="border border-gray-300 px-2 py-1 rounded-full flex items-center"
                            >
                              <ReactCountryFlag
                                countryCode={country.code}
                                svg
                                className="inline-block mr-1"
                              />
                              <span className="mr-2 text-sm">
                                {country.name} ({country.code})
                              </span>
                              <button
                                type="button"
                                onClick={() => removeCountry(code)}
                                className="text-red-500 text-sm font-bold"
                              >
                                x
                              </button>
                            </div>
                          );
                        })}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Row 5: Has Expiration and Expiration Date */}
              <div>
                <FormField
                  control={form.control}
                  name="hasExpiration"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Has Expiration Date?</FormLabel>
                      <FormControl>
                        <label className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            checked={field.value}
                            onChange={(e) => field.onChange(e.target.checked)}
                            className="h-4 w-4"
                          />
                          <span>{field.value ? "Yes" : "No"}</span>
                        </label>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div>
                {form.watch("hasExpiration") && (
                  <FormField
                    control={form.control}
                    name="expirationDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Expiration Date</FormLabel>
                        <FormControl>
                          <Popover
                            open={openDatePicker}
                            onOpenChange={setOpenDatePicker}
                          >
                            <PopoverTrigger asChild>
                              <Button
                                variant={"outline"}
                                onClick={() => setOpenDatePicker(true)}
                                className={cn(
                                  "w-full justify-start text-left font-normal",
                                  !date && "text-muted-foreground"
                                )}
                              >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {date ? (
                                  format(date, "PPP")
                                ) : (
                                  <span>Pick a date</span>
                                )}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0">
                              <Calendar
                                mode="single"
                                selected={date}
                                onSelect={(d: Date | null) => {
                                  setDate(d);
                                  if (d) {
                                    field.onChange(
                                      d.toISOString().split("T")[0]
                                    );
                                  } else {
                                    field.onChange(null);
                                  }
                                  setOpenDatePicker(false);
                                }}
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>

              {/* Row 6: Limit Per User and Visibility */}
              <div>
                <FormField
                  control={form.control}
                  name="limitPerUser"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Limit Per User</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} placeholder="0" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div>
                <FormField
                  control={form.control}
                  name="visibility"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Visibility</FormLabel>
                      <FormControl>
                        <label className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            checked={field.value}
                            onChange={(e) => field.onChange(e.target.checked)}
                            className="h-4 w-4"
                          />
                          <span>{field.value ? "Visible" : "Hidden"}</span>
                        </label>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Submit/Cancel Buttons */}
            <div className="flex justify-center gap-4 mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push("/coupons")}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? isEditing
                    ? "Updating..."
                    : "Creating..."
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
