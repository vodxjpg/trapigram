"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarIcon } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

// Import react-select for organization and countries.
import Select from "react-select";

// Import the Switch component from shadcn
import { Switch } from "@/components/ui/switch";

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
  countries: z
    .array(z.string().length(2))
    .min(1, "At least one country is required"),
  organizationId: z.string().min(1, "Organization is required"),
  visibility: z.boolean().default(true),
  hasExpiration: z.boolean().default(false),
  expirationDate: z.string().nullable().optional(),
  limitPerUser: z.coerce
    .number()
    .int()
    .min(0, "Limit per user must be 0 or greater")
    .default(0),
});

type CouponFormValues = z.infer<typeof couponFormSchema>;

type CouponFormProps = {
  couponData?: CouponFormValues | null;
  isEditing?: boolean;
};

export function CouponForm({ couponData, isEditing = false }: CouponFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [date, setDate] = useState<Date | null>(null);
  const [openDatePicker, setOpenDatePicker] = useState(false);

  // Organizations options state. Each option includes a "countries" property.
  const [orgOptions, setOrgOptions] = useState<
    { value: string; label: string; countries?: string }[]
  >([]);
  // Country select options based on the selected organization.
  const [countryOptions, setCountryOptions] = useState<{ value: string; label: string }[]>([]);

  const form = useForm<CouponFormValues>({
    resolver: zodResolver(couponFormSchema),
    defaultValues: {
      name: "",
      code: "",
      description: "",
      usageLimit: 0,
      expendingLimit: 0,
      countries: [],
      organizationId: "",
      visibility: true,
      hasExpiration: false,
      expirationDate: null,
      limitPerUser: 0,
    },
  });

  // Fetch organizations for the logged-in user.
  useEffect(() => {
    async function fetchOrganizations() {
      try {
        const response = await fetch("/api/organizations");
        if (!response.ok) {
          throw new Error("Failed to fetch organizations");
        }
        const data = await response.json();
        // Map organizations to options.
        const options = data.organizations.map((org: any) => ({
          value: org.id,
          label: org.name,
          countries: org.countries, // Expected as a JSON string or comma-separated list.
        }));
        setOrgOptions(options);
      } catch (error: any) {
        console.error("Error fetching organizations:", error);
        toast.error(error.message || "Failed to load organizations");
      }
    }
    fetchOrganizations();
  }, []);

  // When organization is selected, update countryOptions.
  useEffect(() => {
    const selectedOrgId = form.watch("organizationId");
    if (selectedOrgId) {
      const org = orgOptions.find((option) => option.value === selectedOrgId);
      if (org && org.countries) {
        let orgCountries: string[] = [];
        try {
          const parsed = JSON.parse(org.countries);
          if (Array.isArray(parsed)) {
            orgCountries = parsed;
          } else {
            orgCountries = [];
          }
        } catch (e) {
          // Fallback: assume comma separated.
          orgCountries = org.countries.split(",").map((c: string) => c.trim());
        }
        const options = orgCountries.map((code: string) => {
          const found = allCountries.find((c) => c.code === code);
          return { value: code, label: found ? found.name : code };
        });
        setCountryOptions(options);
      } else {
        setCountryOptions([]);
      }
    } else {
      setCountryOptions([]);
    }
  }, [form.watch("organizationId"), orgOptions]);

  // Reset the form when editing.
  useEffect(() => {
    if (isEditing && couponData) {
      const countriesValue =
        Array.isArray(couponData.countries)
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
        organizationId: "",
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
      const response = await fetch(url, {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.error || `Failed to ${isEditing ? "update" : "create"} coupon`
        );
      }
      toast.success(
        isEditing ? "Coupon updated successfully" : "Coupon created successfully"
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

              {/* Row 4: Organization Select & Countries Multi-Select */}
              <div className="md:col-span-2 grid grid-cols-2 gap-4">
                {/* Organization Select using react-select */}
                <div>
                  <FormField
                    control={form.control}
                    name="organizationId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Organization *</FormLabel>
                        <FormControl>
                          <div>
                            <Select
                              options={orgOptions}
                              placeholder="Select an organization"
                              value={
                                orgOptions.find(
                                  (option) => option.value === field.value
                                ) || null
                              }
                              onChange={(selectedOption: any) =>
                                field.onChange(selectedOption ? selectedOption.value : "")
                              }
                            />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                {/* Countries Multi-Select using react-select */}
                <div>
                  <FormField
                    control={form.control}
                    name="countries"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Countries *</FormLabel>
                        <FormControl>
                          <div>
                            <Select
                              isMulti
                              options={countryOptions}
                              placeholder="Select country(s)"
                              value={countryOptions.filter((option) =>
                                field.value.includes(option.value)
                              )}
                              onChange={(selectedOptions: any) =>
                                field.onChange(selectedOptions.map((option: any) => option.value))
                              }
                              formatOptionLabel={(option: { value: string; label: string }) => (
                                <div className="flex items-center gap-2">
                                  <ReactCountryFlag
                                    countryCode={option.value}
                                    svg
                                    style={{ width: "1.5em", height: "1.5em" }}
                                  />
                                  <span>{option.label}</span>
                                </div>
                              )}
                            />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
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
                          <Popover open={openDatePicker} onOpenChange={setOpenDatePicker}>
                            <PopoverTrigger asChild>
                              <Button
                                variant={"outline"}
                                onClick={() => setOpenDatePicker(true)}
                                className={cn("w-full justify-start text-left font-normal", !date && "text-muted-foreground")}
                              >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {date ? format(date, "PPP") : <span>Pick a date</span>}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0">
                              <Calendar
                                mode="single"
                                selected={date}
                                onSelect={(d: Date | null) => {
                                  setDate(d);
                                  if (d) {
                                    field.onChange(d.toISOString().split("T")[0]);
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
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            className="mr-2"
                          />
                          <span>{field.value ? "Visible" : "Hidden"}</span>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Submit/Cancel Buttons */}
            <div className="flex justify-center gap-4 mt-6">
              <Button type="button" variant="outline" onClick={() => router.push("/coupons")}>
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
