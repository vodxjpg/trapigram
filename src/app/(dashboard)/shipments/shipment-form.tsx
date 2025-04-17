"use client";

import { useState, useEffect } from "react";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar as CalendarIcon, Plus } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

// ---------- Countries Setup ----------
import countriesLib from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";
import { getCountries } from "libphonenumber-js";
import ReactCountryFlag from "react-country-flag";
import { PlusCircle } from "lucide-react";

countriesLib.registerLocale(enLocale);
const allCountries = getCountries().map((code) => ({
  code,
  name: countriesLib.getName(code, "en") || code,
}));

// ---------- Cost Group Schema ----------
const costGroupSchema = z.object({
  minOrderCost: z.coerce
    .number()
    .min(0, "Minimum order cost must be 0 or greater")
    .default(0),
  maxOrderCost: z.coerce
    .number()
    .min(0, "Maximum order cost must be 0 or greater")
    .default(0),
  shipmentCost: z.coerce
    .number()
    .min(0, "Shipment cost must be 0 or greater")
    .default(0),
});

// ---------- Shipment Schema ----------
// This schema includes title, description, minOrderCost, maxOrderCost, shipmentCost, countries, and organizationId.
const shipmentFormSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().min(1, "Description is required"),
  costs: z.array(costGroupSchema).min(1, "At least one cost group is required"),
  countries: z.array(z.string()).min(1, "Select at least one country"),
});

type ShipmentFormValues = z.infer<typeof shipmentFormSchema>;

type ShipmentFormProps = {
  shipmentData?: ShipmentFormValues | null;
  isEditing?: boolean;
};

export function ShipmentForm({
  shipmentData,
  isEditing = false,
}: ShipmentFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  // For countries multi‑select options.
  const [countryOptions, setCountryOptions] = useState<
    { value: string; label: string }[]
  >([]);

  const form = useForm<ShipmentFormValues>({
    resolver: zodResolver(shipmentFormSchema),
    defaultValues: {
      title: "",
      description: "",
      costs: [{ minOrderCost: 0, maxOrderCost: 0, shipmentCost: 0 }],
      countries: [],
    },
  });

  // Set up the field array for cost groups.
  const { fields, append } = useFieldArray({
    control: form.control,
    name: "costs",
  });

  // Watch the cost groups to determine if the plus button should be enabled per group.
  const costGroups = useWatch({ control: form.control, name: "costs" });

  // Function to check conditions for a cost group.
  const isCostGroupValid = (group: {
    minOrderCost: number;
    maxOrderCost: number;
    shipmentCost: number;
  }) => group.minOrderCost < group.maxOrderCost && group.shipmentCost !== 0;

  // When the plus button is clicked for a specific group, append a new group
  // with its minOrderCost set to the current group's maxOrderCost + 0.01.
  const handleAddCostGroup = (index: number) => {
    const group = costGroups[index];

    if (group && isCostGroupValid(group)) {
      append({
        minOrderCost: Number(group.maxOrderCost) + 0.01,
        maxOrderCost: "",
        shipmentCost: "",
      });
    }
  };

  // Fetch the countries for the organization using your endpoint.
  useEffect(() => {
    async function fetchOrganizationCountries() {
      try {
        const response = await fetch(`/api/organizations/countries`, {
          headers: {
            "x-internal-secret":
              process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "",
          },
        });
        if (!response.ok) {
          throw new Error("Failed to fetch organization countries");
        }
        const data = await response.json();
        // Assume data.countries is a JSON string or comma-separated list.
        let orgCountries: string[] = [];
        try {
          const parsed = JSON.parse(data.countries);
          if (Array.isArray(parsed)) {
            orgCountries = parsed;
          } else {
            orgCountries = [];
          }
        } catch (e) {
          orgCountries = data.countries.split(",").map((c: string) => c.trim());
        }
        const options = orgCountries.map((code: string) => {
          const found = allCountries.find((c) => c.code === code);
          return { value: code, label: found ? found.name : code };
        });
        setCountryOptions(options);
      } catch (error: any) {
        console.error("Error fetching organization countries:", error);
        toast.error(error.message || "Failed to load organization countries");
      }
    }
    fetchOrganizationCountries();
  }, []);

  // Reset the form when editing.
  useEffect(() => {
    if (isEditing && shipmentData) {
      const countriesValue = Array.isArray(shipmentData.countries)
        ? shipmentData.countries
        : typeof shipmentData.countries === "string"
          ? JSON.parse(shipmentData.countries)
          : [];
      form.reset({
        ...shipmentData,
        countries: countriesValue,
      });
    } else {
      form.reset({
        title: "",
        description: "",
        costs: [
          {
            minOrderCost: "",
            maxOrderCost: "",
            shipmentCost: 0,
          },
        ],
        countries: [],
      });
    }
  }, [shipmentData, form, isEditing]);

  async function onSubmit(values: ShipmentFormValues) {
    setIsSubmitting(true);
    try {
      const url = isEditing
        ? `/api/shipments/${shipmentData?.id}`
        : "/api/shipments";
      // Combine cost inputs into one JSON string.
      const costs = JSON.stringify({
        minOrderCost: values.minOrderCost,
        maxOrderCost: values.maxOrderCost,
        shipmentCost: values.shipmentCost,
      });
      // Build the payload.
      const payload = {
        title: values.title,
        description: values.description,
        countries: JSON.stringify(values.countries),
        costs: JSON.stringify(values.costs),
      };
      const response = await fetch(url, {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.error ||
            `Failed to ${isEditing ? "update" : "create"} shipment`
        );
      }
      toast.success(
        isEditing
          ? "Shipment updated successfully"
          : "Shipment created successfully"
      );
      router.push("/shipments");
      router.refresh();
    } catch (error: any) {
      console.error(
        `Error ${isEditing ? "updating" : "creating"} shipment:`,
        error
      );
      toast.error(
        error.message || `Failed to ${isEditing ? "update" : "create"} shipment`
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
            {/* Row 1: Title and Description (Two-column grid) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Title *</FormLabel>
                    <FormControl>
                      <Input placeholder="Shipment Title" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description *</FormLabel>
                    <FormControl>
                      <Input placeholder="Shipment Description" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Row 2: Countries Multi-Select */}
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
                            field.onChange(
                              selectedOptions.map((option: any) => option.value)
                            )
                          }
                          formatOptionLabel={(option: {
                            value: string;
                            label: string;
                          }) => (
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

            {/* Row 3: Cost Inputs */}
            <div className="flex justify-center items-center p-4">
              <div className="w-full max-w-4xl">
                {fields.map((field, index) => {
                  const currentGroup = costGroups[index];
                  const plusDisabled = !(
                    currentGroup &&
                    currentGroup.minOrderCost < currentGroup.maxOrderCost &&
                    currentGroup.shipmentCost !== 0
                  );
                  return (
                    <div
                      key={field.id}
                      className="flex flex-row gap-4 items-end p-1"
                    >
                      <div className="flex-1">
                        <FormField
                          control={form.control}
                          name={`costs.${index}.minOrderCost` as const}
                          render={({ field }) => (
                            <FormItem>
                              {index === 0 && (
                                <FormLabel>Min Order Cost</FormLabel>
                              )}
                              <FormControl>
                                <Input
                                  type="number"
                                  placeholder="0"
                                  {...field}
                                  disabled={index !== 0} // Disable min order input for newly appended groups
                                  className="appearance-none [&::-webkit-inner-spin-button]:hidden [&::-webkit-outer-spin-button]:hidden"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="flex-1">
                        <FormField
                          control={form.control}
                          name={`costs.${index}.maxOrderCost` as const}
                          render={({ field }) => (
                            <FormItem>
                              {index === 0 && (
                                <FormLabel>Max Order Cost</FormLabel>
                              )}
                              <FormControl>
                                <Input
                                  type="number"
                                  placeholder={index === 0 ? "0" : "Max"}
                                  {...field}
                                  className="appearance-none [&::-webkit-inner-spin-button]:hidden [&::-webkit-outer-spin-button]:hidden"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="flex-1">
                        <FormField
                          control={form.control}
                          name={`costs.${index}.shipmentCost` as const}
                          render={({ field }) => (
                            <FormItem>
                              {index === 0 && (
                                <FormLabel>Shipment Cost</FormLabel>
                              )}
                              <FormControl>
                                <Input
                                  type="number"
                                  placeholder="0"
                                  {...field}
                                  className="appearance-none [&::-webkit-inner-spin-button]:hidden [&::-webkit-outer-spin-button]:hidden"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <Button
                        type="button"
                        size="icon"
                        disabled={plusDisabled}
                        className="shrink-0"
                        onClick={() => handleAddCostGroup(index)}
                      >
                        <PlusCircle className="h-5 w-5" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Submit/Cancel Buttons */}
            <div className="flex justify-center gap-4 mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push("/shipments")}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? isEditing
                    ? "Updating..."
                    : "Creating..."
                  : isEditing
                    ? "Update Shipment"
                    : "Create Shipment"}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
