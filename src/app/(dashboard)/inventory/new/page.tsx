"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Filter } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

type Warehouse = {
  id: string;
  name: string;
  countries: string;
};

type FormData = {
  reference: string;
  warehouse: string;
};

export default function InventoryCount() {
  const router = useRouter(); // ✅ add router for navigation
  const [countType, setCountType] = useState<"all" | "specific">("all");
  const [warehouseOptions, setWarehouseOptions] = useState<Warehouse[]>([]);

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

  const onSubmit = async (data: FormData) => {
    if (!data.warehouse) return;

    // ✅ Find selected warehouse object to extract countries
    const selected = warehouseOptions.find((wh) => wh.id === data.warehouse);

    const countries = selected?.countries ?? null;

    try {
      const payload = {
        reference: data.reference,
        warehouseId: data.warehouse,
        countType,
        countries, // ✅ include countries in payload
      };

      const response = await fetch("/api/inventory", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
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
          <CardContent className="pt-6">
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                placeholder="Filter by product name, brand, product type, supplier, season, tag..."
                className="pl-10 w-full"
              />
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end">
        <Button type="submit" className="px-8">
          Continue
        </Button>
      </div>
    </form>
  );
}
