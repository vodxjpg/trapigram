"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
} from "@/components/ui/drawer";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import Select from "react-select";
import ReactCountryFlag from "react-country-flag";
import countriesLib from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";

countriesLib.registerLocale(enLocale);

type Warehouse = {
  id: string;
  tenantId: string | null;
  organizationId: string[];
  name: string;
  countries: string[];
  createdAt: Date;
  updatedAt: Date;
};

type Organization = {
  id: string;
  name: string;
  countries: string[];
};

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  organizationIds: z.array(z.string()).min(1, "Select at least one organization"),
  countries: z.array(z.string()).min(1, "Select at least one country"),
});

type FormValues = z.infer<typeof formSchema>;

interface WarehouseDrawerProps {
  open: boolean;
  onClose: (refreshData?: boolean) => void;
  warehouse: Warehouse | null;
}

export function WarehouseDrawer({ open, onClose, warehouse }: WarehouseDrawerProps) {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [availableCountries, setAvailableCountries] = useState<string[]>([]);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      organizationIds: [],
      countries: [],
    },
  });

  useEffect(() => {
    if (open) {
      fetchOrganizations();
    }
  }, [open, warehouse, form]);

  useEffect(() => {
    if (warehouse) {
      const orgIds = Array.isArray(warehouse.organizationId) ? warehouse.organizationId : [];
      const countries = Array.isArray(warehouse.countries) ? warehouse.countries : [];
      form.reset({
        name: warehouse.name,
        organizationIds: orgIds,
        countries: countries,
      });
    } else {
      form.reset({
        name: "",
        organizationIds: [],
        countries: [],
      });
    }
  }, [warehouse, form]);

  useEffect(() => {
    const selectedOrgIds = form.watch("organizationIds");
    const selectedOrgs = organizations.filter((org) => selectedOrgIds.includes(org.id));
    const countriesSet = new Set<string>();
    selectedOrgs.forEach((org) => {
      const countryList = Array.isArray(org.countries)
        ? org.countries
        : typeof org.countries === "string"
        ? JSON.parse(org.countries)
        : [];
      countryList.forEach((country) => countriesSet.add(country));
    });
    setAvailableCountries(Array.from(countriesSet));
    const currentCountries = form.getValues("countries");
    const validCountries = currentCountries.filter((c) => countriesSet.has(c));
    if (validCountries.length !== currentCountries.length) {
      form.setValue("countries", validCountries);
    }
  }, [form.watch("organizationIds"), organizations, form]);

  const fetchOrganizations = async () => {
    try {
     // AFTER
const response = await fetch("/api/organizations", {
  credentials: "include",
})
if (!response.ok) {
  throw new Error(`Failed to fetch organizations: ${response.statusText}`)
}
      const data = await response.json();
      const transformedOrganizations = data.organizations.map((org: any) => ({
        ...org,
        countries: typeof org.countries === "string" ? JSON.parse(org.countries) : org.countries || [],
      }));
      setOrganizations(transformedOrganizations);
  
      // Reset form after organizations are fetched
      if (warehouse) {
        const orgIds = Array.isArray(warehouse.organizationId) ? warehouse.organizationId : [];
        const countries = Array.isArray(warehouse.countries) ? warehouse.countries : [];
        form.reset({
          name: warehouse.name,
          organizationIds: orgIds,
          countries: countries,
        });
      }
    } catch (error) {
      console.error("Error fetching organizations:", error);
      toast.error("Failed to load organizations");
    }
  };
  

  // src/app/(dashboard)/warehouses/warehouse-drawer.tsx
  const onSubmit = async (values: FormValues) => {
    try {
      const url = warehouse ? `/api/warehouses/${warehouse.id}` : "/api/warehouses";
      const method = warehouse ? "PUT" : "POST";
      const payload = {
        name: values.name,
        organizationId: values.organizationIds, // Already an array
        countries: values.countries, // Already an array
        // Remove tenantId here; it's set server-side
      };
      console.log("Sending payload:", payload);
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET as string,
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to save warehouse: ${response.status} - ${errorText}`);
      }
      toast.success(warehouse ? "Warehouse updated" : "Warehouse created");
      onClose(true);
    } catch (error) {
      console.error("Error saving warehouse:", error);
      toast.error(`Failed to save warehouse: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  return (
    <Drawer open={open} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{warehouse ? "Edit Warehouse" : "Add Warehouse"}</DrawerTitle>
          <DrawerDescription>
            {warehouse ? "Update warehouse details." : "Create a new warehouse."}
          </DrawerDescription>
        </DrawerHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 px-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Warehouse name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="organizationIds"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Organizations</FormLabel>
                  <FormControl>
                    <Select
                      isMulti
                      options={organizations.map((org) => ({
                        value: org.id,
                        label: org.name,
                      }))}
                      value={organizations
                        .filter((org) => field.value.includes(org.id))
                        .map((org) => ({ value: org.id, label: org.name }))}
                      onChange={(selected) =>
                        field.onChange(selected.map((option) => option.value))
                      }
                      placeholder="Select organizations"
                    />
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
                  <FormLabel>Countries</FormLabel>
                  <FormControl>
                    <Select
                      isMulti
                      options={availableCountries.map((country) => ({
                        value: country,
                        label: (
                          <div className="flex items-center">
                            <ReactCountryFlag
                              countryCode={country}
                              svg
                              style={{ width: "1em", height: "1em", marginRight: "8px" }}
                            />
                            {countriesLib.getName(country, "en") || country}
                          </div>
                        ),
                      }))}
                      value={field.value.map((country) => ({
                        value: country,
                        label: (
                          <div className="flex items-center">
                            <ReactCountryFlag
                              countryCode={country}
                              svg
                              style={{ width: "1em", height: "1em", marginRight: "8px" }}
                            />
                            {countriesLib.getName(country, "en") || country}
                          </div>
                        ),
                      }))}
                      onChange={(selected) =>
                        field.onChange(selected.map((option) => option.value))
                      }
                      placeholder="Select countries"
                      isDisabled={!availableCountries.length}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DrawerFooter>
              <Button type="submit">Save</Button>
              <Button variant="outline" onClick={() => onClose()}>
                Cancel
              </Button>
            </DrawerFooter>
          </form>
        </Form>
      </DrawerContent>
    </Drawer>
  );
}