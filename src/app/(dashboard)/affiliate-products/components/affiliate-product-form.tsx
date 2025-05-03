// src/app/(dashboard)/affiliate-products/components/affiliate-product-form.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { v4 as uuidv4 } from "uuid";
import Image from "next/image";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { mutate as swrMutate } from "swr";
import { toast } from "sonner";

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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

import type { Warehouse, Variation } from "@/types/product";
import { StockManagement } from "@/app/(dashboard)/products/components/stock-management";
import { PointsManagement } from "./points-management";
import { ProductAttributes } from "@/app/(dashboard)/products/components/product-attributes";
import { AffiliateProductVariations } from "./affiliate-product-variations";
import { CostManagement } from "@/app/(dashboard)/products/components/cost-management";

/* ──────────────────────────────────────────────────────────── */
/* Rich‑text editor                                             */
/* ──────────────────────────────────────────────────────────── */
const ReactQuill = dynamic(() => import("react-quill-new"), { ssr: false });
import "react-quill-new/dist/quill.snow.css";
const quillModules = {
  toolbar: [
    [{ header: [1, 2, false] }],
    ["bold", "italic", "underline", "strike", "blockquote"],
    [{ list: "ordered" }, { list: "bullet" }],
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

/* ──────────────────────────────────────────────────────────── */
/* Types & Zod                                                  */
/* ──────────────────────────────────────────────────────────── */
type CountryPts = { regular: number; sale: number | null };
type PointsMap  = Record<string, CountryPts>;
export type CostMap = Record<string, number>;

type VariationExt = Variation & {
  prices: PointsMap;   // points per country
  cost:   CostMap;     // cost per country
};

const ptsObj = z.object({ regular: z.number().min(0), sale: z.number().nullable() });
const productSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  image: z.string().nullable().optional(),
  sku: z.string().optional(),
  status: z.enum(["published", "draft"]),
  productType: z.enum(["simple", "variable"]),
  allowBackorders: z.boolean(),
  manageStock: z.boolean(),
  pointsPrice: z.record(z.string(), ptsObj),        // simple products only
  cost:        z.record(z.string(), z.number().min(0)).optional(), // simple products only
});
type FormVals = z.infer<typeof productSchema>;

/* helpers */
const blankPtsFor  = (cc: string[]): PointsMap => cc.reduce((a,c)=>(a[c]={regular:0,sale:null},a),{} as PointsMap);
const blankCostFor = (cc: string[]): CostMap  => cc.reduce((a,c)=>(a[c]=0,a),{} as CostMap);

/* ──────────────────────────────────────────────────────────── */
interface Props {
  productId?: string;
  initialData?: Partial<FormVals> & {
    attributes?: any[];
    variations?: VariationExt[];
    warehouseStock?: {
      warehouseId: string;
      variationId: string | null;
      country: string;
      quantity: number;
    }[];
  };
}

export function AffiliateProductForm({ productId, initialData }: Props) {
  const router = useRouter();

  /* dynamic org data */
  const [countries,  setCountries ] = useState<string[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [stockData,  setStockData ] = useState<Record<string, Record<string, number>>>({});

  /* simple‑level cost map */
  const [costs, setCosts] = useState<CostMap>({});

  /* attributes & variations */
  const [attributes, setAttributes] = useState(initialData?.attributes || []);
  const [variations, setVariations] = useState<VariationExt[]>(
    (initialData?.variations as VariationExt[]) || [],
  );

  /* fetch countries + warehouses once */
  useEffect(() => {
    (async () => {
      /* countries */
      const cRes = await fetch("/api/organizations/countries");
      const { countries: raw } = await cRes.json();
      const cc: string[] = Array.isArray(raw) ? raw : JSON.parse(raw);
      setCountries(cc);

      /* cost map init */
      if (initialData?.cost) {
        setCosts(initialData.cost as CostMap);
      } else {
        setCosts(blankCostFor(cc));
      }

      /* warehouses */
      const wRes = await fetch("/api/warehouses");
      const { warehouses: wh } = await wRes.json();
      setWarehouses(wh);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* build blank stockData */
  useEffect(() => {
    if (!warehouses.length || !countries.length) return;
    const obj: Record<string, Record<string, number>> = {};
    warehouses.forEach(w=>{
      obj[w.id]={};
      w.countries.forEach(c=>obj[w.id][c]=0);
    });

    initialData?.warehouseStock?.forEach(row=>{
      if (!obj[row.warehouseId]) obj[row.warehouseId]={};
      obj[row.warehouseId][row.country]=row.quantity;
    });
    setStockData(obj);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouses,countries]);

  /* RHF */
  const form = useForm<FormVals>({
    resolver: zodResolver(productSchema),
    defaultValues: initialData ? (initialData as any) : {
      title:"",
      description:"",
      image:null,
      sku:"",
      status:"draft",
      productType:"simple",
      allowBackorders:false,
      manageStock:false,
      pointsPrice: blankPtsFor(countries),
      cost:        blankCostFor(countries),
    },
  });

  /* ensure blank points map for new product after countries load */
  useEffect(()=>{
    if(!countries.length) return;
    if(Object.keys(form.getValues("pointsPrice")).length) return;
    form.setValue("pointsPrice", blankPtsFor(countries));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[countries]);

  const productType = form.watch("productType");
  const manageStock = form.watch("manageStock");
  const ptsPrice    = form.watch("pointsPrice");

  /* image preview */
  const [imgPreview,setImgPreview] = useState<string|null>(initialData?.image ?? null);
  const [submitting,setSubmitting] = useState(false);

  const handleUpload = async (e:React.ChangeEvent<HTMLInputElement>)=>{
    const file=e.target.files?.[0];
    if(!file) return;
    const fd=new FormData(); fd.append("file",file);
    const { filePath } = await fetch("/api/upload",{method:"POST",body:fd}).then(r=>r.json());
    setImgPreview(filePath);
    form.setValue("image",filePath);
  };

  /* transform stockData ➜ rows */
  const stockRows = ()=>{
    const arr:{warehouseId:string;affiliateProductId:string;variationId:string|null;country:string;quantity:number;}[]=[];
    for(const [wId,byCountry] of Object.entries(stockData))
      for(const [c,qty] of Object.entries(byCountry))
        if(qty>0) arr.push({warehouseId:wId,affiliateProductId:productId||"TEMP",variationId:null,country:c,quantity:qty});
    return arr;
  };

  /* submit */
  const onSubmit = async (values:FormVals)=>{
    setSubmitting(true);
    try{
      const payload:any = {
        ...values,
        attributes,
        warehouseStock: manageStock ? stockRows() : undefined,
        cost: productType==="simple" ? costs : undefined,
        pointsPrice: productType==="simple" ? values.pointsPrice : undefined,
        variations: productType==="variable" ? variations : undefined,
      };

      const url    = productId ? `/api/affiliate-products/${productId}` : "/api/affiliate-products";
      const method = productId ? "PATCH" : "POST";

      const res  = await fetch(url,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      const data = await res.json().catch(()=>({}));
      if(!res.ok){
        const msg = Array.isArray(data?.error)
          ? data.error.map((e:any)=>e.message).join(" • ")
          : data.error || "Failed to save";
        toast.error(msg); return;
      }

      swrMutate(k=>k.startsWith("/api/affiliate-products"));
      toast.success(productId?"Product updated":"Product created");
      router.push("/affiliate-products"); router.refresh();
    }finally{ setSubmitting(false); }
  };

  /* UI */
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <Tabs defaultValue="general" className="w-full">
        <TabsList
          className={`grid w-full ${
            form.watch("productType") === "variable" ? "grid-cols-4" : "grid-cols-5"
          }`}
        >
            <TabsTrigger value="general">General</TabsTrigger>
            {form.watch("productType") === "simple" && (
              <TabsTrigger value="points">Points</TabsTrigger>
            )}
            <TabsTrigger value="inventory">Inventory</TabsTrigger>
            <TabsTrigger value="attributes">Attributes</TabsTrigger>
            <TabsTrigger
              value="variations"
              disabled={form.watch("productType") !== "variable"}
            >
              Variations
            </TabsTrigger>
          </TabsList>

          {/* ── GENERAL ───────────────────────────────────────── */}
          <TabsContent value="general" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Basic Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* image + main fields */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* image column */}
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
                          <select
                            className="w-full border rounded-md px-3 py-2"
                            value={field.value}
                            onChange={field.onChange}
                          >
                            <option value="simple">Simple</option>
                            <option value="variable">Variable</option>
                          </select>
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

         {/* POINTS & COST (simple products only) */}
         {productType==="simple" && (
            <TabsContent value="points" className="space-y-6">
              <PointsManagement
                title="Points per country"
                countries={countries}
                pointsData={ptsPrice}
                onChange={m=>form.setValue("pointsPrice",m)}
              />
              <CostManagement
                title="Cost per country"
                countries={countries}
                costData={costs}
                onChange={setCosts}
              />
            </TabsContent>
          )}


          {/* ── INVENTORY ─────────────────────────────────────── */}
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

          {/* ── ATTRIBUTES ────────────────────────────────────── */}
          <TabsContent value="attributes" className="space-y-6">
            <ProductAttributes
              attributes={attributes}
              onAttributesChange={setAttributes}
              productType={productType}
            />
          </TabsContent>

          {/* ── VARIATIONS ────────────────────────────────────── */}
          <TabsContent value="variations" className="space-y-6">
            <AffiliateProductVariations
              attributes={attributes.filter((a: any) => a.useForVariations)}
              variations={variations as any}
              onVariationsChange={setVariations as any}
              warehouses={warehouses}
              countries={countries}
            />
          </TabsContent>
        </Tabs>

        {/* footer buttons */}
        <div className="flex justify-end gap-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/affiliate-products")}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {productId ? "Update" : "Create"} Affiliate Product
          </Button>
        </div>
      </form>
    </Form>
  );
}
