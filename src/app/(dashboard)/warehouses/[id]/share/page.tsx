"use client";

import React from "react";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import Select from "react-select";
import { Trash2, Plus, ArrowLeft, AlertCircle, X } from "lucide-react";
import countriesLib from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";
import ReactCountryFlag from "react-country-flag";

countriesLib.registerLocale(enLocale);

type User = {
  id: string;
  email: string;
  name: string | null;
};

type StockItem = {
  productId: string;
  variationId: string | null;
  title: string;
  cost: Record<string, number>;
  country: string;
  quantity: number;
  productType: "simple" | "variable";
  categoryId: string | null;
  categoryName: string;
};

// Update costSchema to only validate that costs, if provided, are positive
const costSchema = z.record(z.string(), z.number().positive("Cost must be a positive number")).optional();

// Update productSchema to include custom validation for countries and costs
const productSchema = z.object({
  productId: z.string().min(1, "Product is required"),
  variationId: z.string().nullable(),
  cost: costSchema,
}).superRefine((data, ctx) => {
  // This validation will be handled in the form using selectedCountries
  // We'll check in the form's onSubmit to ensure costs are provided for selected countries
});

const formSchema = z.object({
  recipientUserIds: z.array(z.string()).min(1, "Select at least one recipient"),
  products: z.array(productSchema).min(1, "Select at least one product"),
});

type FormValues = z.infer<typeof formSchema>;

export default function ShareWarehousePage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [stock, setStock] = useState<StockItem[]>([]);
  const [countries, setCountries] = useState<string[]>([]);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [emailSearch, setEmailSearch] = useState("");
  const [stockError, setStockError] = useState<string | null>(null);
  const [selectedCountries, setSelectedCountries] = useState<Record<number, string[]>>({});

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      recipientUserIds: [],
      products: [],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "products",
  });

  useEffect(() => {
    fetchStock();
  }, [params.id]);

  const fetchStock = async () => {
    try {
      const response = await fetch(`/api/warehouses/${params.id}/stock`, {
        headers: {
          "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET as string,
        },
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch stock: ${response.status}`);
      }
      const data = await response.json();
      setStock(data.stock);
      setCountries(data.countries);
      setStockError(null);
    } catch (error) {
      console.error("Error fetching stock:", error);
      setStockError("Failed to load warehouse stock. Please try again.");
      toast.error("Failed to load warehouse stock");
    }
  };

  const handleEmailSearch = async () => {
    if (!emailSearch) {
      setUsers([]);
      return;
    }
    try {
      const response = await fetch(`/api/users/search?email=${encodeURIComponent(emailSearch)}`, {
        headers: {
          "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET as string,
        },
      });
      if (!response.ok) throw new Error("Failed to fetch users");
      const data = await response.json();
      setUsers(data.users);
      if (data.users.length === 0) {
        toast.info("No users found with that email");
      }
    } catch (error) {
      console.error("Error fetching users:", error);
      toast.error("Failed to load users");
    }
  };

  const onSubmit = async (values: FormValues) => {
    try {
      // Validate that each product has at least one cost for its selected countries
      const validationErrors: string[] = [];
      values.products.forEach((product, index) => {
        const productCountries = selectedCountries[index] || [];
        if (productCountries.length === 0) {
          validationErrors.push(`Product ${index + 1}: At least one country must be selected.`);
          form.setError(`products.${index}.cost`, {
            type: "manual",
            message: "At least one country must be selected.",
          });
          return;
        }

        const cleanedCost = product.cost
          ? Object.fromEntries(
              Object.entries(product.cost).filter(([_, value]) => value !== undefined)
            )
          : {};
        const costCountries = Object.keys(cleanedCost);

        if (costCountries.length === 0) {
          validationErrors.push(`Product ${index + 1}: At least one country with a valid cost is required.`);
          form.setError(`products.${index}.cost`, {
            type: "manual",
            message: "At least one country with a valid cost is required.",
          });
          return;
        }

        // Ensure all selected countries have a cost
        const missingCostCountries = productCountries.filter(
          (country) => !costCountries.includes(country)
        );
        if (missingCostCountries.length > 0) {
          validationErrors.push(
            `Product ${index + 1}: Costs are required for ${missingCostCountries.join(", ")}.`
          );
          form.setError(`products.${index}.cost`, {
            type: "manual",
            message: `Costs are required for ${missingCostCountries.join(", ")}.`,
          });
        }
      });

      if (validationErrors.length > 0) {
        toast.error("Please fix the validation errors before submitting.");
        return;
      }

      const cleanedValues = {
        ...values,
        products: values.products.map((product, index) => ({
          ...product,
          cost: product.cost
            ? Object.fromEntries(
                Object.entries(product.cost).filter(([_, value]) => value !== undefined)
              )
            : {},
        })),
      };

      const response = await fetch(`/api/warehouses/${params.id}/share-links`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET as string,
        },
        body: JSON.stringify(cleanedValues),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          `Failed to create share link: ${response.status} - ${errorData.error || "Unknown error"}`
        );
      }
      const data = await response.json();
      setShareUrl(data.url);
      toast.success("Share link created successfully");
    } catch (error) {
      console.error("Error creating share link:", error);
      toast.error(`Failed to create share link: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const addProduct = () => {
    const newIndex = fields.length;
    append({ productId: "", variationId: null, cost: {} });
    setSelectedCountries((prev) => ({
      ...prev,
      [newIndex]: [...countries],
    }));
  };

  const selectAllProducts = () => {
    const newProducts = stock.map((item) => ({
      productId: item.productId,
      variationId: item.variationId,
      cost: Object.fromEntries(
        countries.map((country) => [country, (item.cost[country] || 0) + 10])
      ),
    }));
    form.setValue("products", newProducts);
    setSelectedCountries(
      newProducts.reduce((acc, _, index) => ({
        ...acc,
        [index]: [...countries],
      }), {} as Record<number, string[]>)
    );
  };

  const removeCountry = (productIndex: number, country: string) => {
    setSelectedCountries((prev) => ({
      ...prev,
      [productIndex]: prev[productIndex].filter((c) => c !== country),
    }));
    const currentCost = form.getValues(`products.${productIndex}.cost`) || {};
    const newCost = { ...currentCost };
    delete newCost[country];
    form.setValue(`products.${productIndex}.cost`, newCost);
    // Clear any existing cost validation errors
    form.clearErrors(`products.${productIndex}.cost`);
  };

  const addCountry = (productIndex: number, country: string) => {
    setSelectedCountries((prev) => ({
      ...prev,
      [productIndex]: [...prev[productIndex], country],
    }));
    // Clear any existing cost validation errors
    form.clearErrors(`products.${productIndex}.cost`);
  };

  const groupedStock = stock.reduce((acc, item) => {
    const category = item.categoryName || "Uncategorized";
    if (!acc[category]) acc[category] = [];
    acc[category].push(item);
    return acc;
  }, {} as Record<string, StockItem[]>);

  const stockByProduct = stock.reduce((acc, item) => {
    const key = `${item.productId}-${item.variationId || "none"}`;
    if (!acc[key]) {
      acc[key] = {};
    }
    acc[key][item.country] = item.quantity;
    return acc;
  }, {} as Record<string, Record<string, number>>);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="outline" onClick={() => router.push("/warehouses")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Warehouses
        </Button>
        <h1 className="text-3xl font-bold">Create Share Link</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Share Warehouse Products</CardTitle>
          <p className="text-muted-foreground">
            Select recipients, products, and specific countries to share via a private link.
          </p>
        </CardHeader>
        <CardContent>
          {stockError && (
            <Alert variant="destructive" className="mb-6">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{stockError}</AlertDescription>
            </Alert>
          )}
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
              <div className="space-y-4">
                <FormField
                  control={form.control}
                  name="recipientUserIds"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Recipients</FormLabel>
                      <div className="flex gap-2">
                        <Input
                          placeholder="Search user by email"
                          value={emailSearch}
                          onChange={(e) => setEmailSearch(e.target.value)}
                        />
                        <Button type="button" onClick={handleEmailSearch}>
                          Search
                        </Button>
                      </div>
                      {users.length > 0 && (
                        <FormControl>
                          <Select
                            isMulti
                            options={users.map((user) => ({
                              value: user.id,
                              label: user.name ? `${user.name} (${user.email})` : user.email,
                            }))}
                            value={users
                              .filter((user) => field.value.includes(user.id))
                              .map((user) => ({
                                value: user.id,
                                label: user.name ? `${user.name} (${user.email})` : user.email,
                              }))}
                            onChange={(selected) =>
                              field.onChange(selected.map((option) => option.value))
                            }
                            placeholder="Select recipients"
                          />
                        </FormControl>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <FormLabel>Products</FormLabel>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={selectAllProducts}
                      disabled={stock.length === 0}
                    >
                      Select All Products
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={addProduct}
                      disabled={stock.length === 0}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Product
                    </Button>
                  </div>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Variation</TableHead>
                      <TableHead>Costs and Stock by Country</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fields.map((field, index) => {
                      const selectedProductId = form.watch(`products.${index}.productId`);
                      const selectedVariationId = form.watch(`products.${index}.variationId`);
                      const selectedProduct = stock.find((s) => s.productId === selectedProductId);
                      const isVariable = selectedProduct?.productType === "variable";
                      const variations = isVariable
                        ? stock.filter((s) => s.productId === selectedProductId && s.variationId)
                        : [];
                      const stockKey = `${selectedProductId}-${selectedVariationId || "none"}`;
                      const productStock = stockByProduct[stockKey] || {};
                      const productCountries = selectedCountries[index] || countries;
                      const availableCountries = countries.filter(
                        (c) => !productCountries.includes(c)
                      );

                      return (
                        <TableRow key={field.id}>
                          <TableCell>
                            <FormField
                              control={form.control}
                              name={`products.${index}.productId`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormControl>
                                    <Select
                                      options={[
                                        {
                                          label: "Select a product",
                                          value: "",
                                          disabled: true,
                                        },
                                        ...Object.entries(groupedStock).map(([category, items]) => ({
                                          label: category,
                                          options: items
                                            .filter(
                                              (s, i, self) =>
                                                self.findIndex((x) => x.productId === s.productId) === i
                                            )
                                            .map((s) => ({
                                              value: s.productId,
                                              label: s.title,
                                            })),
                                        })),
                                      ]}
                                      value={
                                        field.value
                                          ? {
                                              value: field.value,
                                              label: stock.find((s) => s.productId === field.value)?.title,
                                            }
                                          : null
                                      }
                                      onChange={(option) => {
                                        field.onChange(option?.value || "");
                                        form.setValue(`products.${index}.variationId`, null);
                                        form.setValue(`products.${index}.cost`, {});
                                        setSelectedCountries((prev) => ({
                                          ...prev,
                                          [index]: [...countries],
                                        }));
                                      }}
                                      placeholder="Select product"
                                      isDisabled={stock.length === 0}
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </TableCell>
                          <TableCell>
                            {isVariable && (
                              <FormField
                                control={form.control}
                                name={`products.${index}.variationId`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormControl>
                                      <Select
                                        options={variations.map((v) => ({
                                          value: v.variationId!,
                                          label: v.title,
                                        }))}
                                        value={
                                          field.value
                                            ? {
                                                value: field.value,
                                                label: variations.find((v) => v.variationId === field.value)
                                                  ?.title,
                                              }
                                            : null
                                        }
                                        onChange={(option) => {
                                          field.onChange(option?.value || null);
                                          form.setValue(`products.${index}.cost`, {});
                                          setSelectedCountries((prev) => ({
                                            ...prev,
                                            [index]: [...countries],
                                          }));
                                        }}
                                        placeholder="Select variation"
                                        isDisabled={!selectedProductId}
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            )}
                          </TableCell>
                          <TableCell>
                            <FormField
                              control={form.control}
                              name={`products.${index}.cost`}
                              render={() => (
                                <FormItem>
                                  <div className="space-y-2">
                                    {productCountries.map((country) => {
                                      const baseCost = selectedProduct?.cost[country] || 0;
                                      const stockQuantity = productStock[country] || 0;
                                      return (
                                        <div key={country} className="flex items-center gap-2">
                                          <div className="flex-1">
                                            <FormField
                                              control={form.control}
                                              name={`products.${index}.cost.${country}`}
                                              render={({ field }) => (
                                                <FormItem>
                                                  <FormLabel className="flex items-center">
                                                    <ReactCountryFlag
                                                      countryCode={country}
                                                      svg
                                                      style={{ width: "1em", height: "1em", marginRight: "8px" }}
                                                    />
                                                    {countriesLib.getName(country, "en") || country} (Base: {baseCost}, Stock: {stockQuantity})
                                                  </FormLabel>
                                                  <FormControl>
                                                    <Input
                                                      type="number"
                                                      min="0"
                                                      step="0.01"
                                                      placeholder={`Enter cost for ${country}`}
                                                      value={field.value !== undefined ? field.value : ""}
                                                      onChange={(e) => {
                                                        field.onChange(
                                                          e.target.value ? Number(e.target.value) : undefined
                                                        );
                                                        // Clear error when user starts typing
                                                        if (e.target.value) {
                                                          form.clearErrors(`products.${index}.cost`);
                                                        }
                                                      }}
                                                      disabled={!selectedProductId}
                                                    />
                                                  </FormControl>
                                                  <FormMessage />
                                                </FormItem>
                                              )}
                                            />
                                          </div>
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => removeCountry(index, country)}
                                            disabled={productCountries.length <= 1 && !availableCountries.length}
                                          >
                                            <X className="h-4 w-4" />
                                          </Button>
                                        </div>
                                      );
                                    })}
                                    {availableCountries.length > 0 && (
                                      <FormItem>
                                        <FormLabel>Add Country</FormLabel>
                                        <Select
                                          options={availableCountries.map((country) => ({
                                            value: country,
                                            label: countriesLib.getName(country, "en") || country,
                                          }))}
                                          onChange={(option) => {
                                            if (option) addCountry(index, option.value);
                                          }}
                                          placeholder="Select a country to add"
                                          isDisabled={!selectedProductId}
                                        />
                                      </FormItem>
                                    )}
                                  </div>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                remove(index);
                                setSelectedCountries((prev) => {
                                  const newState = { ...prev };
                                  delete newState[index];
                                  return newState;
                                });
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {shareUrl && (
                <Card>
                  <CardHeader>
                    <CardTitle>Share Link Created</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2">
                      <Input value={shareUrl} readOnly />
                      <Button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(shareUrl);
                          toast.success("Link copied to clipboard");
                        }}
                      >
                        Copy
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
              <div className="flex gap-4">
                <Button type="submit" disabled={!!shareUrl || stock.length === 0}>
                  Create Share Link
                </Button>
                <Button variant="outline" onClick={() => router.push("/warehouses")}>
                  Cancel
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}