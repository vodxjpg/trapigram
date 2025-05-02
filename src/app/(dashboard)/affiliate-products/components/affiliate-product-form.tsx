"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { v4 as uuidv4 } from "uuid"
import { Loader2 } from "lucide-react"
import dynamic from "next/dynamic"
import { mutate as swrMutate } from "swr"
import Image from "next/image"

import { Button } from "@/components/ui/button"
import {
  Form, FormControl, FormDescription, FormField, FormItem,
  FormLabel, FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from "sonner"
import { PointsManagement } from "./points-management"
import { StockManagement } from "@/app/(dashboard)/products/components/stock-management"
import type { Warehouse } from "@/types/product"

/* rich‑text (same config) */
const ReactQuill = dynamic(() => import("react-quill-new"), { ssr: false })
import "react-quill-new/dist/quill.snow.css"
const quillModules = {
  toolbar: [
    [{ header: [1, 2, false] }],
    ["bold", "italic", "underline", "strike", "blockquote"],
    [{ list: "ordered" }, { list: "bullet" }],
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
  "indent",
  "link",
  "image",
]

/* validation */
const pointsMap = z.record(z.string(), z.number().min(0))
const schema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  image: z.string().nullable().optional(),
  sku: z.string().optional(),
  status: z.enum(["published", "draft"]),
  productType: z.enum(["simple", "variable"]),
  allowBackorders: z.boolean(),
  manageStock: z.boolean(),
  pointsPrice: pointsMap,
})
type FormVals = z.infer<typeof schema>

/* props */
interface Props {
  productId?: string
  initialData?: Partial<FormVals>
}

export function AffiliateProductForm({ productId, initialData }: Props) {
  const router = useRouter()

  /* dynamic org data */
  const [countries, setCountries] = useState<string[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [stockData, setStockData] = useState<Record<string, Record<string, number>>>({})

  useEffect(() => {
    ;(async () => {
      const res = await fetch("/api/organizations/countries")
      const { countries } = await res.json()
      const list = Array.isArray(countries) ? countries : JSON.parse(countries)
      setCountries(list)

      const whRes = await fetch("/api/warehouses")
      const { warehouses: wh } = await whRes.json()
      setWarehouses(wh)

      /* initialise blank stock */
      const blank: Record<string, Record<string, number>> = {}
      wh.forEach((w: Warehouse) => {
        blank[w.id] = {}
        w.countries.forEach((c: string) => (blank[w.id][c] = 0))
      })
      setStockData(blank)
    })()
  }, [])

  /* form */
  const form = useForm<FormVals>({
    resolver: zodResolver(schema),
    defaultValues: initialData
      ? {
          ...initialData,
          title: initialData.title ?? "",
          description: initialData.description ?? "",
          image: initialData.image ?? null,
          sku: initialData.sku ?? "",
          status: initialData.status ?? "draft",
          productType: initialData.productType ?? "simple",
          allowBackorders: initialData.allowBackorders ?? false,
          manageStock: initialData.manageStock ?? false,
          pointsPrice: initialData.pointsPrice ?? {},
        }
      : {
          title: "",
          description: "",
          image: null,
          sku: "",
          status: "draft",
          productType: "simple",
          allowBackorders: false,
          manageStock: false,
          pointsPrice: {},
        },
  })

  useEffect(() => {
    if (!initialData) return
    form.reset({
      ...initialData,
      title: initialData.title ?? "",
      description: initialData.description ?? "",
      image: initialData.image ?? null,
      sku: initialData.sku ?? "",
      status: initialData.status ?? "draft",
      productType: initialData.productType ?? "simple",
      allowBackorders: initialData.allowBackorders ?? false,
      manageStock: initialData.manageStock ?? false,
      pointsPrice: initialData.pointsPrice ?? {},
    })
  }, [initialData, form])

  const productType = form.watch("productType")
  const manageStock = form.watch("manageStock")
  const [imgPreview, setImgPreview] = useState<string | null>(initialData?.image ?? null)
  const [submitting, setSubmitting] = useState(false)

  /* image upload */
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const fd = new FormData()
    fd.append("file", file)
    const res = await fetch("/api/upload", { method: "POST", body: fd })
    const { filePath } = await res.json()
    setImgPreview(filePath)
    form.setValue("image", filePath)
  }

  /* submit */
  const onSubmit = async (values: FormVals) => {
    setSubmitting(true)
    try {
      const url = productId ? `/api/affiliate-products/${productId}` : "/api/affiliate-products"
      const method = productId ? "PATCH" : "POST"
      const payload = { ...values }
      if (productType === "simple") payload.pointsPrice = values.pointsPrice
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || "Failed to save")
        return
      }
      swrMutate((k: string) => k.startsWith("/api/affiliate-products"))
      toast.success(productId ? "Updated" : "Created")
      router.push("/affiliate-products")
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }   
  /* UI --------------------------------------------------------- */
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <Tabs defaultValue="general" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="points">Points</TabsTrigger>
            <TabsTrigger value="inventory">Inventory</TabsTrigger>
          </TabsList>

          {/* GENERAL TAB */}
          <TabsContent value="general" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Basic Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* image */}
                  <div className="space-y-4">
                    <FormLabel>Featured Image</FormLabel>
                    {imgPreview ? (
                      <Image
                        src={imgPreview}
                        alt="preview"
                        width={400}
                        height={400}
                        className="rounded-md object-cover w-full h-64"
                      />
                    ) : (
                      <div className="border border-dashed h-64 flex items-center justify-center rounded-md">
                        <span className="text-sm text-muted-foreground">No image</span>
                      </div>
                    )}
                    <Input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      id="aff-img-input"
                      onChange={handleUpload}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        document.getElementById("aff-img-input")?.click()
                      }
                      className="w-full"
                    >
                      {imgPreview ? "Change Image" : "Upload Image"}
                    </Button>
                  </div>

                  {/* right column */}
                  <div className="space-y-6">
                    <FormField
                      control={form.control}
                      name="title"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Title</FormLabel>
                          <FormControl>
                            <Input placeholder="Product title" {...field} />
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
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Type" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="simple">Simple</SelectItem>
                              <SelectItem value="variable">Variable</SelectItem>
                            </SelectContent>
                          </Select>
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
                          <FormControl>
                            <Input placeholder="Optional SKU" {...field} />
                          </FormControl>
                          <FormDescription>
                            Leave blank to auto‑generate
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem className="col-span-full">
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <ReactQuill
                          theme="snow"
                          modules={quillModules}
                          formats={quillFormats}
                          value={field.value || ""}
                          onChange={field.onChange}
                          className="min-h-[200px]"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* POINTS TAB */}
          <TabsContent value="points" className="space-y-6">
            <PointsManagement
              title="Points per country"
              countries={countries}
              pointsData={form.watch("pointsPrice")}
              onChange={(map) => form.setValue("pointsPrice", map)}
            />
          </TabsContent>

          {/* INVENTORY TAB */}
          <TabsContent value="inventory" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Stock Management</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <FormField
                  control={form.control}
                  name="manageStock"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between p-4 border rounded-lg">
                      <div>
                        <FormLabel>Manage Stock</FormLabel>
                        <FormDescription>
                          Track inventory at warehouse/country level
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
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
                    <FormItem className="flex items-center justify-between p-4 border rounded-lg">
                      <div>
                        <FormLabel>Allow Backorders</FormLabel>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                {manageStock && (
                  <StockManagement
                    warehouses={warehouses}
                    stockData={stockData}
                    onStockChange={setStockData}
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-4">
          <Button type="button" variant="outline" onClick={() => router.push("/affiliate-products")}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {productId ? "Update" : "Create"} Affiliate Product
          </Button>
        </div>
      </form>
    </Form>
  )
}