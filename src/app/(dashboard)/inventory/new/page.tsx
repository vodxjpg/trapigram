"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Filter, ChevronsUpDown, Check } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
  CommandEmpty,
} from "@/components/ui/command";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";

type Warehouse = {
  id: string;
  name: string;
  countries: string;
};

type ProductCategory = {
  id: string;
  name: string;
};

type FormData = {
  reference: string;
  warehouse: string;
};

export default function InventoryCount() {
  const router = useRouter();
   // permissions: need update to create
 const { data: activeOrg } = authClient.useActiveOrganization();
 const orgId = activeOrg?.id ?? null;
 const { hasPermission: canView, isLoading: viewLoading } = useHasPermission(orgId, { stockManagement: ["view"] });
 const { hasPermission: canUpdate, isLoading: updateLoading } = useHasPermission(orgId, { stockManagement: ["update"] });
 useEffect(() => {
   if (!viewLoading && (!canView || !canUpdate)) router.replace("/inventory");
 }, [viewLoading, canView, canUpdate, router]);
 if (viewLoading || updateLoading || !canView || !canUpdate) return null;

  const [countType, setCountType] = useState<"all" | "specific">("all");
  const [warehouseOptions, setWarehouseOptions] = useState<Warehouse[]>([]);
  const [productCategories, setProductCategories] = useState<ProductCategory[]>(
    []
  );
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [categoryPopoverOpen, setCategoryPopoverOpen] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormData>({
    defaultValues: {
      reference: "",
      warehouse: "",
    },
  });

  const selectedWarehouse = watch("warehouse");

  useEffect(() => {
    async function fetchWarehouses() {
      try {
        const response = await fetch("/api/warehouses");
        const data = await response.json();
        const warehouses = data.warehouses as Warehouse[];
        setWarehouseOptions(warehouses);
      } catch (error) {
        console.error("Failed to fetch warehouses", error);
      }
    }

    fetchWarehouses();
  }, []);

  // Fetch product categories when switching to "specific" (Partial)
  useEffect(() => {
    if (countType !== "specific" || productCategories.length > 0) return;

    let isMounted = true;
    (async () => {
      try {
        setLoadingCategories(true);
        setCategoriesError(null);
        const resp = await fetch("/api/product-categories?pageSize=200");
        if (!resp.ok)
          throw new Error(`Failed to fetch categories: ${resp.status}`);
        const data = await resp.json();
        console.log(data);

        const list: any[] = Array.isArray(data)
          ? data
          : Array.isArray(data?.categories)
            ? data.categories
            : [];

        const normalized: ProductCategory[] = list.map((c: any, i: number) => ({
          id: String(c?.id ?? c?._id ?? i),
          name: String(c?.name ?? c?.title ?? `Category ${i + 1}`),
        }));

        if (isMounted) setProductCategories(normalized);
      } catch (e: any) {
        if (isMounted) setCategoriesError(e?.message ?? "Unknown error");
      } finally {
        if (isMounted) setLoadingCategories(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [countType, productCategories.length]);

  const onSubmit = async (data: FormData) => {
     if (!canUpdate) return;
    if (!data.warehouse) return;

    // Find selected warehouse object to extract countries
    const selected = warehouseOptions.find((wh) => wh.id === data.warehouse);
    const countries = selected?.countries ?? null;

    try {
      // Build payload, adding `categories` only for "specific"
      const basePayload = {
        reference: data.reference,
        warehouseId: data.warehouse,
        countType,
        countries,
      } as Record<string, unknown>;

      if (countType === "specific") {
        // Use the exact key name provided: `categories`
        basePayload.categories = selectedCategoryIds; // <-- intentionally spelled as requested
      }

      const response = await fetch("/api/inventory", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(basePayload),
      });

      if (!response.ok) {
        throw new Error("Failed to create inventory count");
      }

      const result = await response.json();

      if (!result.id) {
        throw new Error("No inventory ID returned in response");
      }

      router.push(`/inventory/${result.id}`);
    } catch (error) {
      console.error("Error submitting form:", error);
    }
  };

  const toggleCategory = (id: string) => {
    setSelectedCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectedSummary =
    selectedCategoryIds.length === 0
      ? "Select categories"
      : selectedCategoryIds.length === 1
        ? (productCategories.find((c) => c.id === selectedCategoryIds[0])
            ?.name ?? "1 selected")
        : `${selectedCategoryIds.length} selected`;

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="max-w-4xl mx-auto p-6 space-y-6"
    >
      <h1 className="text-2xl font-semibold text-gray-900">
        New inventory count
      </h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-medium text-black">
            Count info
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label
                htmlFor="reference"
                className="text-sm font-medium text-gray-700"
              >
                Reference
              </Label>
              <Input
                id="reference"
                placeholder="Enter reference"
                className="w-full"
                {...register("reference", {
                  required: "Reference is required",
                })}
              />
              {errors.reference && (
                <p className="text-sm text-red-500 mt-1">
                  {errors.reference.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium text-gray-700">
                Warehouse
              </Label>
              <Select
                value={selectedWarehouse}
                onValueChange={(value) =>
                  setValue("warehouse", value, { shouldValidate: true })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select warehouse" />
                </SelectTrigger>
                <SelectContent>
                  {warehouseOptions.map((wh) => (
                    <SelectItem key={wh.id} value={wh.id}>
                      {wh.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.warehouse && (
                <p className="text-sm text-red-500 mt-1">
                  {errors.warehouse.message}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <Label className="text-sm font-medium text-gray-700">
              Count type
            </Label>
            <div className="flex items-center space-x-3">
              <span
                className={`text-sm ${
                  countType === "all"
                    ? "text-gray-500"
                    : "text-gray-900 font-medium"
                }`}
              >
                Specific inventory items
              </span>
              <Switch
                checked={countType === "all"}
                onCheckedChange={(checked) =>
                  setCountType(checked ? "all" : "specific")
                }
              />
              <span
                className={`text-sm ${
                  countType === "specific"
                    ? "text-gray-500"
                    : "text-gray-900 font-medium"
                }`}
              >
                All inventory count
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {countType === "specific" && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center gap-2">
              <Filter className="text-gray-400 h-4 w-4" />
              <Label className="text-sm font-medium text-gray-700">
                Product categories
              </Label>
            </div>

            {/* Multi-select dropdown (Popover + Command) */}
            <div className="w-full">
              <Popover
                open={categoryPopoverOpen}
                onOpenChange={setCategoryPopoverOpen}
              >
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={categoryPopoverOpen}
                    className="w-full justify-between"
                  >
                    <span className="truncate">{selectedSummary}</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-[--radix-popover-trigger-width] p-0"
                  align="start"
                >
                  {loadingCategories ? (
                    <div className="p-3 text-sm text-gray-600">
                      Loading categories…
                    </div>
                  ) : categoriesError ? (
                    <div className="p-3 text-sm text-red-600">
                      {categoriesError}
                    </div>
                  ) : (
                    <Command shouldFilter>
                      <CommandInput placeholder="Search categories..." />
                      <CommandEmpty>No categories found.</CommandEmpty>
                      <CommandList>
                        <CommandGroup>
                          {productCategories.map((cat) => {
                            const checked = selectedCategoryIds.includes(
                              cat.id
                            );
                            return (
                              <CommandItem
                                key={cat.id}
                                onSelect={() => toggleCategory(cat.id)}
                                className="cursor-pointer"
                              >
                                <div className="mr-2 flex h-4 w-4 items-center justify-center border rounded">
                                  {checked ? (
                                    <Check className="h-3 w-3" />
                                  ) : null}
                                </div>
                                <span>{cat.name}</span>
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  )}
                </PopoverContent>
              </Popover>

              {/* Optional: show badges for selected */}
              {selectedCategoryIds.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedCategoryIds.map((id) => {
                    const name =
                      productCategories.find((c) => c.id === id)?.name ?? id;
                    return (
                      <span
                        key={id}
                        className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs"
                      >
                        {name}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end">
         <Button type="submit" className="px-8" disabled={!canUpdate}>
          Continue
        </Button>
      </div>
    </form>
  );
}
