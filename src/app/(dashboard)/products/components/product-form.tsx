"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { v4 as uuidv4 } from "uuid"
import Image from "next/image"
import { Loader2, Upload, X } from "lucide-react"
import ReactQuill from "react-quill-new"
import "react-quill-new/dist/quill.snow.css"

import { Button } from "@/components/ui/button"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import type { Product } from "@/hooks/use-products"
import type { Attribute, Variation, Warehouse } from "@/types/product"
import { StockManagement } from "./stock-management"
import { ProductAttributes } from "./product-attributes"
import { ProductVariations } from "./product-variations"

// Define the form schema
const productSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  image: z.string().nullable().optional(),
  sku: z.string().optional(),
  status: z.enum(["published", "draft"]),
  productType: z.enum(["simple", "variable"]),
  categories: z.array(z.string()).optional(),
  regularPrice: z.coerce.number().min(0, "Price must be a positive number"),
  salePrice: z.coerce.number().min(0, "Sale price must be a positive number").nullable().optional(),
  allowBackorders: z.boolean().default(false),
  manageStock: z.boolean().default(false),
})

type ProductFormValues = z.infer<typeof productSchema>

interface ProductFormProps {
  productId?: string
  initialData?: Product
}

// Add Quill modules and formats
const quillModules = {
  toolbar: [
    [{ header: [1, 2, false] }],
    ["bold", "italic", "underline", "strike", "blockquote"],
    [{ list: "ordered" }, { list: "bullet" }, { indent: "-1" }, { indent: "+1" }],
    ["link", "image"],
    ["clean"],
  ],
}

const quillFormats = [
  "header",
  "bold",
  "italic",
  "underline",
  "strike",
  "blockquote",
  "list",
  "bullet",
  "indent",
  "link",
  "image",
]

export function ProductForm({ productId, initialData }: ProductFormProps = {}) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [imagePreview, setImagePreview] = useState<string | null>(initialData?.image || null)
  const [isCheckingSku, setIsCheckingSku] = useState(false)
  const [skuAvailable, setSkuAvailable] = useState(true)
  const [categories, setCategories] = useState<Array<{ id: string; name: string; slug: string }>>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [stockData, setStockData] = useState<Record<string, Record<string, number>>>({})
  const [attributes, setAttributes] = useState<Attribute[]>([])
  const [variations, setVariations] = useState<Variation[]>([])

  // Initialize form with default values or initial data
  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: initialData
      ? {
          title: initialData.title,
          description: initialData.description || "",
          image: initialData.image,
          sku: initialData.sku,
          status: initialData.status,
          productType: (initialData.productType as "simple" | "variable") || "simple",
          categories: initialData.categories || [],
          regularPrice: initialData.regularPrice,
          salePrice: initialData.salePrice,
          allowBackorders: false,
          manageStock: initialData.stockStatus === "managed",
        }
      : {
          title: "",
          description: "",
          image: null,
          sku: "",
          status: "draft",
          productType: "simple",
          categories: [],
          regularPrice: 0,
          salePrice: null,
          allowBackorders: false,
          manageStock: false,
        },
  })

  const productType = form.watch("productType")
  const manageStock = form.watch("manageStock")

  // Fetch categories on component mount
  useEffect(() => {
    async function fetchCategories() {
      try {
        const response = await fetch("/api/product-categories")
        if (!response.ok) throw new Error("Failed to fetch categories")
        const data = await response.json()
        setCategories(data.categories)
      } catch (error) {
        console.error("Error fetching categories:", error)
        toast.error("Failed to load product categories")
      }
    }

    fetchCategories()
  }, [])

  // Fetch warehouses on component mount
  useEffect(() => {
    async function fetchWarehouses() {
      try {
        const response = await fetch("/api/warehouses")
        if (!response.ok) throw new Error("Failed to fetch warehouses")
        const data = await response.json()
        setWarehouses(data.warehouses)

        // Initialize stock data structure
        const initialStockData: Record<string, Record<string, number>> = {}
        data.warehouses.forEach((warehouse: any) => {
          initialStockData[warehouse.id] = {}
          warehouse.countries.forEach((country: string) => {
            initialStockData[warehouse.id][country] = 0
          })
        })
        setStockData(initialStockData)
      } catch (error) {
        console.error("Error fetching warehouses:", error)
        toast.error("Failed to load warehouses")
      }
    }

    fetchWarehouses()
  }, [])

  // Check SKU availability
  const checkSkuAvailability = async (sku: string) => {
    if (!sku) return true

    setIsCheckingSku(true)
    try {
      const response = await fetch(`/api/products/check-sku?sku=${sku}`)
      if (!response.ok) throw new Error("Failed to check SKU")
      const data = await response.json()

      // If editing, the current product's SKU should be considered available
      if (productId && initialData?.sku === sku) {
        setSkuAvailable(true)
        return true
      }

      setSkuAvailable(!data.exists)
      return !data.exists
    } catch (error) {
      console.error("Error checking SKU:", error)
      return false
    } finally {
      setIsCheckingSku(false)
    }
  }

  // Generate a unique SKU if none provided (returns a string ID)
  const generateSku = () => {
    const prefix = "ORG"
    const randomPart = uuidv4().slice(0, 8)
    return `${prefix}-${randomPart}`
  }

  // Handle image upload
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const formData = new FormData()
    formData.append("file", file)

    try {
      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      })

      if (!response.ok) {
        throw new Error("Failed to upload image")
      }

      const data = await response.json()
      const imageUrl = data.filePath
      setImagePreview(imageUrl)
      form.setValue("image", imageUrl)
    } catch (error) {
      console.error("Error uploading image:", error)
      toast.error("Failed to upload image")
    }
  }

  // Handle form submission
  const onSubmit = async (data: ProductFormValues) => {
    setIsSubmitting(true)

    try {
      // If no SKU provided, generate one
      if (!data.sku) {
        data.sku = generateSku()
      } else {
        // Verify SKU is available
        const isAvailable = await checkSkuAvailability(data.sku)
        if (!isAvailable) {
          toast.error("The SKU is already in use. Please choose another.")
          setIsSubmitting(false)
          return
        }
      }

      // Prepare the payload
      const payload = {
        ...data,
        // For variable products, set parent product price fields to null
        ...(productType === "variable" ? { regularPrice: null, salePrice: null } : {}),
        stockData: manageStock && productType === "simple" ? stockData : null,
        attributes: productType === "variable" ? attributes : [],
        variations: productType === "variable" ? variations : [],
      }

      // Determine if creating or updating
      const url = productId ? `/api/products/${productId}` : "/api/products"
      const method = productId ? "PATCH" : "POST"

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        throw new Error(`Failed to ${productId ? "update" : "create"} product`)
      }

      toast.success(`Product ${productId ? "updated" : "created"} successfully`)
      router.push("/products")
    } catch (error) {
      console.error("Error submitting form:", error)
      toast.error(`Failed to ${productId ? "update" : "create"} product`)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <Tabs defaultValue="general" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="inventory">Inventory</TabsTrigger>
            <TabsTrigger value="attributes">Attributes</TabsTrigger>
            <TabsTrigger value="variations" disabled={productType !== "variable"}>
              Variations
            </TabsTrigger>
          </TabsList>

          {/* General Tab */}
          <TabsContent value="general" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Basic Information</CardTitle>
                <CardDescription>Enter the basic details of your product</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Left Column: Image, Status, Categories */}
                  <div className="space-y-6">
                    <FormItem>
                      <FormLabel>Featured Image</FormLabel>
                      <div className="flex flex-col gap-4">
                        {imagePreview ? (
                          <div className="relative w-full h-64">
                            <Image
                              src={imagePreview || "/placeholder.svg"}
                              alt="Product preview"
                              fill
                              className="object-cover rounded-md"
                            />
                            <Button
                              type="button"
                              variant="destructive"
                              size="icon"
                              className="absolute top-2 right-2 h-8 w-8"
                              onClick={() => {
                                setImagePreview(null)
                                form.setValue("image", null)
                              }}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : (
                          <div className="border border-dashed border-gray-300 rounded-md p-6 flex flex-col items-center justify-center w-full h-64">
                            <Upload className="h-12 w-12 text-gray-400" />
                            <span className="text-sm text-gray-500 mt-2">Upload Image</span>
                          </div>
                        )}
                        <div>
                          <Input
                            type="file"
                            accept="image/*"
                            id="image-upload"
                            className="hidden"
                            onChange={(e) => handleImageUpload(e)}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => document.getElementById("image-upload")?.click()}
                            className="w-full"
                          >
                            {imagePreview ? "Change Image" : "Upload Image"}
                          </Button>
                        </div>
                      </div>
                    </FormItem>

                    <FormField
                      control={form.control}
                      name="status"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Status</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select status" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="published">Published</SelectItem>
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
                              const currentValues = field.value || []
                              if (currentValues.includes(value)) {
                                field.onChange(currentValues.filter((v) => v !== value))
                              } else {
                                field.onChange([...currentValues, value])
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
                                <SelectItem key={category.id} value={category.id}>
                                  {category.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <div className="flex flex-wrap gap-2 mt-2">
                            {(field.value || []).map((categoryId) => {
                              const category = categories.find((c) => c.id === categoryId)
                              return category ? (
                                <Badge key={categoryId} variant="secondary" className="flex items-center gap-1">
                                  {category.name}
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-4 w-4 p-0 ml-1"
                                    onClick={() => {
                                      field.onChange((field.value || []).filter((id) => id !== categoryId))
                                    }}
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                </Badge>
                              ) : null
                            })}
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Right Column: Title, Product Type, Price */}
                  <div className="space-y-6">
                    <FormField
                      control={form.control}
                      name="title"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Product Title</FormLabel>
                          <FormControl>
                            <Input placeholder="Enter product title" {...field} />
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
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select product type" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="simple">Simple Product</SelectItem>
                              <SelectItem value="variable">Variable Product</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormDescription>
                            Simple products have a single SKU and price. Variable products have multiple variations.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {productType === "simple" && (
                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="regularPrice"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Regular Price</FormLabel>
                              <FormControl>
                                <Input type="number" min="0" step="0.01" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="salePrice"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Sale Price (Optional)</FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={field.value === null ? "" : field.value}
                                  onChange={(e) => {
                                    const value = e.target.value === "" ? null : Number.parseFloat(e.target.value)
                                    field.onChange(value)
                                  }}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    )}

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
                                  field.onBlur()
                                  if (e.target.value) {
                                    checkSkuAvailability(e.target.value)
                                  }
                                }}
                              />
                            </FormControl>
                            {isCheckingSku && <Loader2 className="h-4 w-4 animate-spin" />}
                            {field.value && !isCheckingSku && (
                              <Badge variant={skuAvailable ? "outline" : "destructive"}>
                                {skuAvailable ? "Available" : "Already in use"}
                              </Badge>
                            )}
                          </div>
                          <FormDescription>Leave blank to auto-generate a unique SKU</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                {/* Description with React Quill - Full Width */}
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
                      <strong>Note:</strong> For variable products, pricing is set individually for each variation in
                      the Variations tab.
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
                <CardTitle>Inventory Management</CardTitle>
                <CardDescription>Configure stock management settings</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <FormField
                  control={form.control}
                  name="manageStock"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">Manage Stock</FormLabel>
                        <FormDescription>Enable stock management for this product</FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
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
                        <FormLabel className="text-base">Allow Backorders</FormLabel>
                        <FormDescription>Allow customers to purchase products that are out of stock</FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                {manageStock && productType === "simple" && (
                  <StockManagement warehouses={warehouses} stockData={stockData} onStockChange={setStockData} />
                )}

                {manageStock && productType === "variable" && (
                  <div className="rounded-lg border p-4 bg-blue-50">
                    <p className="text-sm text-blue-700">
                      <strong>Note:</strong> For variable products, stock is managed individually for each variation in
                      the Variations tab.
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
                <CardDescription>Add attributes like color, size, etc.</CardDescription>
              </CardHeader>
              <CardContent>
                {productType === "variable" && (
                  <div className="rounded-lg border p-4 bg-blue-50 mb-4">
                    <p className="text-sm text-blue-700">
                      <strong>Important:</strong> For variable products, you need to:
                    </p>
                    <ol className="list-decimal ml-5 mt-2 text-sm text-blue-700">
                      <li>Add attributes (like Color, Size)</li>
                      <li>
                        <strong>Select the terms</strong> you want to use (like Red, Blue, Small, Large)
                      </li>
                      <li>
                        Toggle <strong>"Use for Variations"</strong> for attributes you want to create variations from
                      </li>
                    </ol>
                    <p className="text-sm text-blue-700 mt-2">
                      Then go to the Variations tab to generate product variations based on your selections.
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
                <CardDescription>Configure variations based on attributes</CardDescription>
              </CardHeader>
              <CardContent>
                <ProductVariations
                  attributes={attributes.filter((attr) => attr.useForVariations)}
                  variations={variations}
                  onVariationsChange={setVariations}
                  warehouses={warehouses}
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-4">
          <Button type="button" variant="outline" onClick={() => router.push("/products")}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {productId ? "Update Product" : "Create Product"}
          </Button>
        </div>
      </form>
    </Form>
  )
}
