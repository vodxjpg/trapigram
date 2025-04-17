// src/app/(dashboard)/shipping-methods/shipping-method-form.tsx
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import Select from "react-select";
import countriesLib from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";
import { getCountries } from "libphonenumber-js";
import ReactCountryFlag from "react-country-flag";

countriesLib.registerLocale(enLocale);
const allCountries = getCountries().map((code) => ({
  code,
  name: countriesLib.getName(code, "en") || code,
}));

const shippingMethodSchema = z.object({
  name: z.string().min(1, "Name is required"),
  countries: z.array(z.string().length(2)).min(1, "At least one country is required"),
});

type ShippingMethodFormValues = z.infer<typeof shippingMethodSchema>;

type ShippingMethodFormProps = {
  methodData?: ShippingMethodFormValues & { id: string } | null;
  isEditing?: boolean;
};

export function ShippingMethodForm({
  methodData,
  isEditing = false,
}: ShippingMethodFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [countryOptions, setCountryOptions] = useState<{ value: string; label: string }[]>([]);

  const form = useForm<ShippingMethodFormValues>({
    resolver: zodResolver(shippingMethodSchema),
    defaultValues: {
      name: "",
      countries: [],
    },
  });

  // Load organization countries
  useEffect(() => {
    async function fetchOrganizationCountries() {
      try {
        const res = await fetch(`/api/organizations/countries`, {
          headers: { "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "" },
        });
        if (!res.ok) throw new Error("Failed to load countries");
        const data = await res.json();
        let codes: string[] = [];
        try {
          const parsed = JSON.parse(data.countries);
          if (Array.isArray(parsed)) codes = parsed;
        } catch {
          codes = data.countries.split(",").map((c: string) => c.trim());
        }
        setCountryOptions(
          codes.map((code) => {
            const found = allCountries.find((c) => c.code === code);
            return { value: code, label: found ? found.name : code };
          })
        );
      } catch (err: any) {
        console.error(err);
        toast.error(err.message || "Could not load countries");
      }
    }
    fetchOrganizationCountries();
  }, []);

  // Populate when editing
  useEffect(() => {
    if (isEditing && methodData) {
      form.reset({
        name: methodData.name,
        countries: methodData.countries,
      });
    }
  }, [isEditing, methodData, form]);

  async function onSubmit(values: ShippingMethodFormValues) {
    setIsSubmitting(true);
    try {
      const url = isEditing
        ? `/api/shipping-methods/${methodData?.id}`
        : "/api/shipping-methods";
      const payload = {
        name: values.name,
        countries: JSON.stringify(values.countries),
      };
      const res = await fetch(url, {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Request failed");
      }
      toast.success(
        isEditing ? "Method updated successfully" : "Method created successfully"
      );
      router.push("/shipping-methods");
      router.refresh();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Could not save");
    } finally {
      setIsSubmitting(false);
    }
  }

  // ...
return (
    <Card className="w-full mx-auto">
      <CardContent className="pt-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
  
            {/* Row 1: Name & Countries side by side */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Name Field */}
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="Method Name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
  
              {/* Countries Multi-Select */}
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
                        value={countryOptions.filter(opt =>
                          field.value.includes(opt.value)
                        )}
                        onChange={opts =>
                          field.onChange(opts.map((o: any) => o.value))
                        }
                        formatOptionLabel={(opt: any) => (
                          <div className="flex items-center gap-2">
                            <ReactCountryFlag
                              countryCode={opt.value}
                              svg
                              style={{ width: "1.5em", height: "1.5em" }}
                            />
                            <span>{opt.label}</span>
                          </div>
                        )}
                        placeholder="Select country(s)"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
  
            {/* Submit / Cancel */}
            <div className="flex justify-center gap-4 mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push("/shippingMethods")}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? isEditing
                    ? "Updating..."
                    : "Creating..."
                  : isEditing
                  ? "Update Method"
                  : "Create Method"}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
  
}
