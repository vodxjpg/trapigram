"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import Image from "next/image";
import { Loader2, Upload, X } from "lucide-react";
import dynamic from "next/dynamic";
import { mutate as swrMutate } from "swr";
import useSWR from "swr";
// Dynamically import ReactQuill to avoid SSR errors
const ReactQuill = dynamic(() => import("react-quill-new"), { ssr: false });
import "react-quill-new/dist/quill.snow.css";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import type { Product } from "@/hooks/use-products";
import type { Attribute, Variation, Warehouse } from "@/types/product";
import { StockManagement } from "./stock-management";
import { ProductAttributes } from "./product-attributes";
import { ProductVariations } from "./product-variations";
import { PriceManagement } from "./price-management";

// --------------------------------------------------
//  helpers / types
// --------------------------------------------------
type PriceMap = Record<string, { regular: number; sale: number | null }>;
type CostMap = Record<string, number>;

// --------------------------------------------------
//  validation schema
// --------------------------------------------------
const priceObj = z.object({
  regular: z.number().min(0),
  sale: z.number().nullable(),
});
const productSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  image: z.string().nullable().optional(),
  sku: z.string().optional(),
  status: z.enum(["published", "draft"]),
  productType: z.enum(["simple", "variable"]),
  categories: z.array(z.string()).optional(),
  allowBackorders: z.boolean().default(false),
  manageStock: z.boolean().default(false),
  prices: z.record(z.string(), priceObj).optional(),
  cost: z.record(z.string(), z.number().min(0)).optional(),
});

type ProductFormValues = z.infer<typeof productSchema>;

interface ProductFormProps {
  productId?: string;
  initialData?: Product;
  shared?: boolean;
}

// --------------------------------------------------
//  ReactQuill config
// --------------------------------------------------
const quillModules = {
  toolbar: [
    [{ header: [1, 2, false] }],
    ["bold", "italic", "underline", "strike", "blockquote"],
    [
      { list: "ordered" },
      { list: "bullet" },
      { indent: "-1" },
      { indent: "+1" },
    ],
    ["link", "image"],
    ["clean"],
  ],
};

const quillFormats = [
  "header",
  "bold",
  "italic",
  "underline",
  "strike",
  "blockquote",
  "list",
  "indent",
  "link",
  "image",
];

// --------------------------------------------------
//  component
// --------------------------------------------------
export function ProductForm({
  productId,
  initialData,
  shared = false,
}: ProductFormProps = {}) {
  const router = useRouter();

  // --------------------------------------------------
  //  local state
  // --------------------------------------------------
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(
    initialData?.image || null
  );
  const [isCheckingSku, setIsCheckingSku] = useState(false);
  const [skuAvailable, setSkuAvailable] = useState(true);
  const [categories, setCategories] = useState<
    Array<{ id: string; name: string; slug: string }>
  >([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [stockData, setStockData] = useState<
    Record<string, Record<string, number>>
  >({});
  const [attributes, setAttributes] = useState<Attribute[]>(
    initialData?.attributes || []
  );
  const [variations, setVariations] = useState<Variation[]>(
    initialData?.variations || []
  );
  const [orgCountries, setOrgCountries] = useState<string[]>([]);
  const [prices, setPrices] = useState<PriceMap>({});
  const [costs, setCosts] = useState<CostMap>({});
  const { data: raw } = useSWR(
    productId ? `/api/products/${productId}` : null,
    async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    }
  );
  const isShared = raw?.shared === true;

  const submitSafely = () => {
    // blur the currently focused element (often the Quill editor)
    if (typeof document !== "undefined") {
      const el = document.activeElement as HTMLElement | null;
      el?.blur?.();
    }
    // trigger RHF submission explicitly (don’t rely on native submit)
    form.handleSubmit(onSubmit)();
  };

  // --------------------------------------------------
  //  parse initial stock for simple products
  // --------------------------------------------------
  useEffect(() => {
    if (!initialData?.stockData) return;
    try {
      const parsed =
        typeof initialData.stockData === "string"
          ? JSON.parse(initialData.stockData)
          : initialData.stockData;
      setStockData(parsed);
    } catch {
      setStockData({});
    }
  }, [initialData]);

  // --------------------------------------------------
  //  fetch organization countries (for pricing & cost maps)
  // --------------------------------------------------
  useEffect(() => {
    (async () => {
      const res = await fetch("/api/organizations/countries");
      if (!res.ok) return;
      const { countries } = await res.json();
      const list = Array.isArray(countries) ? countries : JSON.parse(countries);
      setOrgCountries(list);

      /* prices */
      if (initialData?.prices) {
        setPrices(initialData.prices as PriceMap);
      } else if (!initialData) {
        const blank: PriceMap = {};
        list.forEach((c) => (blank[c] = { regular: 0, sale: null }));
        setPrices(blank);
      }

      /* cost */
      if (initialData?.cost) {
        setCosts(initialData.cost as CostMap);
      } else if (!initialData) {
        const blankCost: CostMap = {};
        list.forEach((c) => (blankCost[c] = 0));
        setCosts(blankCost);
      }
    })();
  }, [initialData]);

  // --------------------------------------------------
  //  react‑hook‑form
  // --------------------------------------------------
  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: initialData
      ? {
          title: initialData.title ?? "",
          description: initialData.description ?? "",
          image: initialData.image ?? null,
          sku: initialData.sku ?? "",
          status: initialData.status ?? "draft",
          productType: initialData.productType ?? "simple",
          categories: initialData.categories ?? [],
          allowBackorders: initialData.allowBackorders ?? false,
          manageStock: initialData.manageStock ?? false,
        }
      : {
          title: "",
          description: "",
          image: null,
          sku: "",
          status: "draft",
          productType: "simple",
          categories: [],
          allowBackorders: false,
          manageStock: false,
        },
  });

  // reset form when initialData changes (edit mode)
  useEffect(() => {
    if (!initialData) return;
    form.reset({
      title: initialData.title ?? "",
      description: initialData.description ?? "",
      image: initialData.image ?? null,
      sku: initialData.sku ?? "",
      status: initialData.status ?? "draft",
      productType: initialData.productType ?? "simple",
      categories: initialData.categories ?? [],
      allowBackorders: initialData.allowBackorders ?? false,
      manageStock: initialData.manageStock ?? false,
    });
    if (initialData.prices) setPrices(initialData.prices as PriceMap);
    if (initialData.cost) setCosts(initialData.cost as CostMap);
    // Explicitly set variations with stock data
    if (initialData.variations) setVariations(initialData.variations);
  }, [initialData, form]);

  // synchronize variations with warehouses and countries
  useEffect(() => {
    if (
      !initialData?.variations ||
      warehouses.length === 0 ||
      orgCountries.length === 0
    )
      return;
    setVariations((cur) =>
      cur.map((v) => {
        const stock: Record<string, Record<string, number>> = {
          ...(v.stock || {}),
        };
        let stockChanged = false;
        warehouses.forEach((w) => {
          if (!stock[w.id]) {
            stock[w.id] = {};
            stockChanged = true;
          }
          w.countries.forEach((c) => {
            if (stock[w.id][c] === undefined) {
              stock[w.id][c] = 0;
              stockChanged = true;
            }
          });
        });
        return stockChanged ? { ...v, stock } : v;
      })
    );
  }, [warehouses, orgCountries, initialData]);

  // watch values that affect UI
  const productType = form.watch("productType");
  const manageStock = form.watch("manageStock");

  // --------------------------------------------------
  //  fetch helpers
  // --------------------------------------------------
  useEffect(() => {
    (async () => {
      const res = await fetch("/api/product-categories");
      if (res.ok) {
        const { categories } = await res.json();
        setCategories(categories);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/warehouses");
      if (!res.ok) return;
      const { warehouses } = await res.json();
      setWarehouses(warehouses);
      if (!initialData) {
        const obj: Record<string, Record<string, number>> = {};
        warehouses.forEach((w: Warehouse) => {
          obj[w.id] = {};
          w.countries.forEach((c: string) => (obj[w.id][c] = 0));
        });
        setStockData(obj);
      }
    })();
  }, [initialData]);

  // --------------------------------------------------
  //  SKU helpers
  // --------------------------------------------------
  const checkSkuAvailability = async (sku: string) => {
    if (!sku) return true;
    setIsCheckingSku(true);
    try {
      const res = await fetch(`/api/products/check-sku?sku=${sku}`);
      const data = await res.json();
      if (productId && initialData?.sku === sku) return true;
      setSkuAvailable(!data.exists);
      return !data.exists;
    } finally {
      setIsCheckingSku(false);
    }
  };

  const generateSku = () => `ORG-${uuidv4().slice(0, 8)}`;

  /* --------------------------------------------------
     image upload  (click OR drag-&-drop)
  -------------------------------------------------- */
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadFile = async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    if (!res.ok) return;
    const { filePath } = await res.json();
    setImagePreview(filePath);
    form.setValue("image", filePath);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  };

  // --------------------------------------------------
  //  transform stock data to warehouseStock format
  // --------------------------------------------------
  const transformStockToWarehouseStock = (
    stockData: Record<string, Record<string, number>>,
    productId: string,
    variationId: string | null = null
  ) => {
    const warehouseStock = [];
    for (const [warehouseId, countries] of Object.entries(stockData)) {
      for (const [country, quantity] of Object.entries(countries)) {
        if (quantity > 0) {
          warehouseStock.push({
            warehouseId,
            productId,
            variationId,
            country,
            quantity,
          });
        }
      }
    }
    return warehouseStock;
  };

  // --------------------------------------------------
  //  submit
  // --------------------------------------------------
  const onSubmit = async (values: ProductFormValues) => {
    setIsSubmitting(true);
    try {
      if (!values.sku) {
        values.sku = generateSku();
      } else if (!(await checkSkuAvailability(values.sku))) {
        toast.error("The SKU is already in use.");
        return;
      }

      let warehouseStock = [];
      if (manageStock && productType === "simple") {
        warehouseStock = transformStockToWarehouseStock(
          stockData,
          productId || uuidv4()
        );
      } else if (productType === "variable" && variations.length > 0) {
        for (const variation of variations) {
          warehouseStock.push(
            ...transformStockToWarehouseStock(
              variation.stock || {},
              productId || uuidv4(),
              variation.id
            )
          );
        }
      }

      const payload = {
        ...values,
        prices: productType === "simple" ? prices : undefined,
        cost: productType === "simple" ? costs : undefined,
        warehouseStock: warehouseStock.length ? warehouseStock : undefined,
        attributes,
        variations: productType === "variable" ? variations : [],
      };

      const url = productId ? `/api/products/${productId}` : "/api/products";
      const method = productId ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg =
          typeof data?.error === "string"
            ? data.error
            : `Failed to ${productId ? "update" : "create"} product`;
        toast.error(msg);
        return;
      }

      const { product } = data;

      /* --------------------------------------------------
         SWR cache updates
      -------------------------------------------------- */
      if (productId) swrMutate(`/api/products/${productId}`, product, false);
      swrMutate((key: string) => key.startsWith("/api/products?"));

      toast.success(
        `Product ${productId ? "updated" : "created"} successfully`
      );
      router.push("/products");
      router.refresh();
    } catch (err) {
      toast.error(`Failed to ${productId ? "update" : "create"} product`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Form {...form}>
      {/* noValidate to avoid mobile native validation from silently blocking */}
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        noValidate
        className="space-y-8"
      >
        <Tabs defaultValue="general" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="inventory">Inventory</TabsTrigger>
            <TabsTrigger value="attributes">Attributes</TabsTrigger>
            <TabsTrigger
              value="variations"
              disabled={productType !== "variable"}
            >
              Variations
            </TabsTrigger>
          </TabsList>

          {/* General Tab */}
          <TabsContent value="general" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Basic Information</CardTitle>
                <CardDescription>
                  Enter the basic details of your product
                </CardDescription>
                {shared && (
                  <div className="rounded-md bg-yellow-50 p-4 mt-4">
                    <p className="text-sm text-yellow-700">
<<<<<<< HEAD
                      <strong>Note:</strong> This is a shared product. You can
                      only edit <em>Title</em>, <em>Description</em>,{" "}
                      <em>Status</em>, <em>Prices</em>.
=======
                      <strong>Note:</strong> This is a shared product, this means that it belongs to a dropshipping supplier. You can only edit{" "}
                      <em>Title</em>, <em>Description</em>, <em>Categories</em>, <em>Status</em>,{" "}
                      <em>Sell Prices</em>.
>>>>>>> 32b5d73d3f0e5cd188ef530307e816bdc39c2c8c
                    </p>
                  </div>
                )}
              </CardHeader>

              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Left Column: Image, Status, Categories */}
                  <div className="space-y-6">
                    <FormItem>
                      <FormLabel>Featured Image</FormLabel>

                      {/* clickable *and* droppable wrapper */}
                      <label
                        htmlFor="image-upload"
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={handleDrop}
                        className="group relative flex w-full h-64 cursor-pointer items-center justify-center rounded-md border border-dashed border-gray-300 transition-colors hover:border-primary/70 hover:bg-muted/50"
                      >
                        {imagePreview ? (
                          <>
                            <Image
                              src={imagePreview}
                              alt="Product preview"
                              fill
                              className="object-cover rounded-md"
                            />
                            <Button
                              type="button"
                              variant="destructive"
                              size="icon"
                              className="absolute top-2 right-2 h-8 w-8 z-20"
                              onClick={(e) => {
                                e.stopPropagation();
                                setImagePreview(null);
                                form.setValue("image", null);
                                if (fileInputRef.current)
                                  fileInputRef.current.value = "";
                              }}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </>
                        ) : (
                          <div className="flex flex-col items-center text-center">
                            <Upload className="h-10 w-10 text-gray-400 transition-colors group-hover:text-primary" />
                            <span className="mt-2 text-sm text-gray-500">
                              Click or drag&nbsp;an&nbsp;image&nbsp;here
                            </span>
                          </div>
                        )}

                        {/* hidden input – sits *under* the delete button */}

                        <Input
                          id="image-upload"
                          type="file"
                          accept="image/*"
                          onChange={handleInputChange}
                          ref={fileInputRef}
                          className="absolute inset-0 h-full w-full cursor-pointer opacity-0 z-0"
                        />
                      </label>
                    </FormItem>
                    <FormField
                      control={form.control}
                      name="status"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Status</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select status" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="published">
                                Published
                              </SelectItem>
                              <SelectItem value="draft">Draft</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="categories"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Categories</FormLabel>
                          <Select
                            onValueChange={(value) => {
                              const currentValues = field.value || [];
                              if (currentValues.includes(value)) {
                                field.onChange(
                                  currentValues.filter((v) => v !== value)
                                );
                              } else {
                                field.onChange([...currentValues, value]);
                              }
                            }}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select categories" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {categories.map((category) => (
                                <SelectItem
                                  key={category.id}
                                  value={category.id}
                                >
                                  {category.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <div className="flex flex-wrap gap-2 mt-2">
                            {(field.value || []).map((categoryId) => {
                              const category = categories.find(
                                (c) => c.id === categoryId
                              );
                              return category ? (
                                <Badge
                                  key={categoryId}
                                  variant="secondary"
                                  className="flex items-center gap-1"
                                >
                                  {category.name}
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-4 w-4 p-0 ml-1"
                                    onClick={() => {
                                      field.onChange(
                                        (field.value || []).filter(
                                          (id) => id !== categoryId
                                        )
                                      );
                                    }}
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                </Badge>
                              ) : null;
                            })}
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  {/* Right Column: Title, Product Type, SKU */}
                  <div className="space-y-6">
                    <FormField
                      control={form.control}
                      name="title"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Product Title</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Enter product title"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="productType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Product Type</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select product type" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="simple">
                                Simple Product
                              </SelectItem>
                              <SelectItem value="variable">
                                Variable Product
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <FormDescription>
                            Simple products have per‑country prices. Variable
                            products have per‑country prices inside each
                            variation.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="sku"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>SKU</FormLabel>
                          <div className="flex items-center gap-2">
                            <FormControl>
                              <Input
                                placeholder="Enter SKU or leave blank to auto-generate"
                                {...field}
                                onBlur={(e) => {
                                  field.onBlur();
                                  if (e.target.value) {
                                    checkSkuAvailability(e.target.value);
                                  }
                                }}
                              />
                            </FormControl>
                            {isCheckingSku && (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            )}
                            {field.value && !isCheckingSku && (
                              <Badge
                                variant={
                                  skuAvailable ? "outline" : "destructive"
                                }
                              >
                                {skuAvailable ? "Available" : "Already in use"}
                              </Badge>
                            )}
                          </div>
                          <FormDescription>
                            Leave blank to auto-generate a unique SKU
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>
                {/* Description with ReactQuill */}
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem className="col-span-full py-5 mb-5">
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <ReactQuill
                          theme="snow"
                          modules={quillModules}
                          formats={quillFormats}
                          value={field.value || ""}
                          onChange={field.onChange}
                          className="h-80 min-h-[400px]"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {productType === "variable" && (
                  <div className="rounded-lg border p-4 bg-blue-50">
                    <p className="text-sm text-blue-700">
                      <strong>Note:</strong> For variable products, pricing is
                      set per country in each variation.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Inventory Tab */}
          <TabsContent value="inventory" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Inventory & Pricing</CardTitle>
                <CardDescription>
                  Configure prices per country and stock management
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {productType === "simple" && (
                  <>
                    <PriceManagement
                      title="Cost & Prices per country"
                      countries={orgCountries}
                      priceData={prices}
                      costData={costs}
                      onPriceChange={setPrices}
                      onCostChange={setCosts}
                    />
                  </>
                )}

                <FormField
                  control={form.control}
                  name="manageStock"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">
                          Manage Stock
                        </FormLabel>
                        <FormDescription>
                          Enable stock management for this product
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          type="button"
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="allowBackorders"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">
                          Allow Backorders
                        </FormLabel>
                        <FormDescription>
                          Allow customers to purchase products that are out of
                          stock
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          type="button"
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                {manageStock && productType === "simple" && (
                  <StockManagement
                    warehouses={warehouses}
                    stockData={stockData}
                    onStockChange={setStockData}
                  />
                )}
                {manageStock && productType === "variable" && (
                  <div className="rounded-lg border p-4 bg-blue-50">
                    <p className="text-sm text-blue-700">
                      <strong>Note:</strong> For variable products, stock is
                      managed individually for each variation in the Variations
                      tab.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Attributes Tab */}
          <TabsContent value="attributes" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Product Attributes</CardTitle>
                <CardDescription>
                  Add attributes like color, size, etc.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {productType === "variable" && (
                  <div className="rounded-lg border p-4 bg-blue-50 mb-4">
                    <p className="text-sm text-blue-700">
                      <strong>Important:</strong> For variable products, you
                      need to:
                    </p>
                    <ol className="list-decimal ml-5 mt-2 text-sm text-blue-700">
                      <li>Add attributes (like Color, Size)</li>
                      <li>
                        <strong>Select the terms</strong> you want to use (like
                        Red, Blue, Small, Large)
                      </li>
                      <li>
                        Toggle <strong>"Use for Variations"</strong> for
                        attributes you want to create variations from
                      </li>
                    </ol>
                    <p className="text-sm text-blue-700 mt-2">
                      Then go to the Variations tab to generate product
                      variations based on your selections.
                    </p>
                  </div>
                )}
                <ProductAttributes
                  attributes={attributes}
                  onAttributesChange={setAttributes}
                  productType={productType}
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* Variations Tab */}
          <TabsContent value="variations" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Product Variations</CardTitle>
                <CardDescription>
                  Configure variations based on attributes
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ProductVariations
                  attributes={attributes.filter(
                    (attr) => attr.useForVariations
                  )}
                  variations={variations}
                  onVariationsChange={setVariations}
                  warehouses={warehouses}
                  countries={orgCountries}
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
        <div className="flex justify-end gap-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/products")}
          >
            Cancel
          </Button>
          {/* Use an explicit click handler instead of native submit to avoid iOS Safari issues */}
          <Button
            type="button"
            onClick={submitSafely}
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {productId ? "Update Product" : "Create Product"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
