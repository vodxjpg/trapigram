"use client";

import type React from "react";
import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
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
import { useIsMobile } from "@/hooks/use-mobile";

// Import countries libraries and flag support.
import countriesLib from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";
import { getCountries } from "libphonenumber-js";
import ReactCountryFlag from "react-country-flag";

// Register locale and prepare a list of all countries.
countriesLib.registerLocale(enLocale);
const allCountries = getCountries().map((code) => ({
  code,
  name: countriesLib.getName(code, "en") || code,
}));

// -------------------------------------------------------------------
// Define the form schema using zod for coupon validation.
// -------------------------------------------------------------------
const couponFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  code: z.string().min(1, "Code is required"),
  description: z.string().min(1, "Description is required"),
  usageLimit: z.coerce.number().int().min(0, "Usage limit must be 0 or greater").default(0),
  expendingLimit: z.coerce.number().int().min(0, "Expending limit must be 0 or greater").default(0),
  // Use an array to store selected country codes.
  countries: z.array(z.string()).min(1, "At least one country is required"),
  // Visibility flag with true as default.
  visibility: z.boolean().default(true),
});

// Define the TypeScript type for form values.
type CouponFormValues = z.infer<typeof couponFormSchema>;

// -------------------------------------------------------------------
// Define the component props.
// -------------------------------------------------------------------
interface CouponDrawerProps {
  open: boolean;
  onClose: (refreshData?: boolean) => void;
  // When editing a coupon, pass its details here; otherwise, null for creation.
  coupon: CouponFormValues | null;
}

// -------------------------------------------------------------------
// CouponDrawer Component
// -------------------------------------------------------------------
export function CouponDrawer({ open, onClose, coupon }: CouponDrawerProps) {
  const isMobile = useIsMobile();
  const [isSubmitting, setIsSubmitting] = useState(false);
  // State for searching countries in the dropdown.
  const [countrySearch, setCountrySearch] = useState("");

  // Initialize react-hook-form with zod as the validation resolver.
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
    },
  });

  // Reset form values when editing an existing coupon.
  useEffect(() => {
    if (coupon) {
      const countriesValue = Array.isArray(coupon.countries)
        ? coupon.countries
        : typeof coupon.countries === "string"
        ? JSON.parse(coupon.countries)
        : [];
      form.reset({
        name: coupon.name,
        code: coupon.code,
        description: coupon.description,
        usageLimit: coupon.usageLimit,
        expendingLimit: coupon.expendingLimit,
        countries: countriesValue,
        visibility: coupon.visibility,
      });
    } else {
      form.reset({
        name: "",
        code: "",
        description: "",
        usageLimit: 0,
        expendingLimit: 0,
        countries: [],
        visibility: true,
      });
    }
  }, [coupon, form]);
  

  // Submit handler to send form data to your backend.
  const onSubmit = async (values: CouponFormValues) => {
    setIsSubmitting(true);
    try {
      const response = await fetch(
        coupon ? `/api/coupons/${(coupon as any).id}` : "/api/coupons",
        {
          method: coupon ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(values),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to save coupon");
      }

      toast.success(coupon ? "Coupon updated successfully" : "Coupon created successfully");
      onClose(true);
    } catch (error) {
      console.error("Error saving coupon:", error);
      toast.error(error instanceof Error ? error.message : "Failed to save coupon");
    } finally {
      setIsSubmitting(false);
    }
  };

  // -----------------------------------------------
  // Functions to manage country selection.
  // -----------------------------------------------
  const addCountry = (code: string) => {
    const current = form.getValues("countries");
    if (!current.includes(code)) {
      form.setValue("countries", [...current, code]);
    }
    setCountrySearch("");
  };

  const removeCountry = (code: string) => {
    const current = form.getValues("countries");
    form.setValue("countries", current.filter((c) => c !== code));
  };

  // Filter the countries list based on the user's search.
  const filteredCountries = allCountries.filter(
    (c) =>
      c.name.toLowerCase().includes(countrySearch.toLowerCase()) ||
      c.code.toLowerCase().includes(countrySearch.toLowerCase())
  );

  return (
    <Drawer open={open} onOpenChange={(openState) => !openState && onClose()} direction={isMobile ? "bottom" : "right"}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{coupon ? "Edit Coupon" : "Add Coupon"}</DrawerTitle>
          <DrawerDescription>
            {coupon ? "Update your coupon details." : "Create a new coupon for your store."}
          </DrawerDescription>
        </DrawerHeader>
        <div className="px-4 overflow-y-auto">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 pb-6">
              {/* Coupon Name */}
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Coupon name" />
                    </FormControl>
                    <FormDescription>The display name for the coupon.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Coupon Code */}
              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Code</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Coupon code" />
                    </FormControl>
                    <FormDescription>The unique coupon code.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Coupon Description */}
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Coupon description" />
                    </FormControl>
                    <FormDescription>A brief description of the coupon.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Usage Limit */}
              <FormField
                control={form.control}
                name="usageLimit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Usage Limit</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} placeholder="0" />
                    </FormControl>
                    <FormDescription>The maximum number of times this coupon can be used.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Expending Limit */}
              <FormField
                control={form.control}
                name="expendingLimit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Expending Limit</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} placeholder="0" />
                    </FormControl>
                    <FormDescription>The spending threshold required for this coupon.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Countries Field */}
              <FormField
                control={form.control}
                name="countries"
                render={() => (
                  <FormItem>
                    <FormLabel>Countries</FormLabel>
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
                              <ReactCountryFlag countryCode={country.code} svg className="inline-block mr-2" />
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
                        const country = allCountries.find((c) => c.code === code);
                        if (!country) return null;
                        return (
                          <div
                            key={code}
                            className="border border-gray-300 px-2 py-1 rounded-full flex items-center"
                          >
                            <ReactCountryFlag countryCode={country.code} svg className="inline-block mr-1" />
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
                    <FormDescription>Select the countries where this coupon is applicable.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Visibility Checkbox */}
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
                    <FormDescription>Toggle whether the coupon is visible.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Drawer Footer with Submit and Cancel buttons */}
              <DrawerFooter className="px-0">
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {coupon ? "Update Coupon" : "Create Coupon"}
                </Button>
                <DrawerClose asChild>
                  <Button variant="outline">Cancel</Button>
                </DrawerClose>
              </DrawerFooter>
            </form>
          </Form>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
