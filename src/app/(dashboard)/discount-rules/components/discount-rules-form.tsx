// src/app/(dashboard)/discount-rules/components/discount-rules-form.tsx
"use client"

import React, { useState, useEffect } from "react"
import { useForm, useFieldArray } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import Select from "react-select"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import countriesLib from "i18n-iso-countries"
import enLocale from "i18n-iso-countries/langs/en.json"
import { getCountries } from "libphonenumber-js"
import ReactCountryFlag from "react-country-flag"

countriesLib.registerLocale(enLocale)
const allCountries = getCountries().map(c => ({ code: c, name: countriesLib.getName(c, "en") || c }))

/* ──────────────────────────────── */
/*  Schemas                         */
/* ──────────────────────────────── */
const stepSchema = z.object({
  fromUnits: z.coerce.number().min(1),
  toUnits  : z.coerce.number().min(1),
  price    : z.coerce.number().positive(),
})
const productItemSchema = z
  .object({ productId: z.string().uuid().nullable(), variationId: z.string().uuid().nullable() })
  .refine(d => d.productId || d.variationId, { message: "Select either a product or a variation" })
const formSchema = z.object({
  name     : z.string().min(1, "Name is required"),
  countries: z.array(z.string().length(2)).min(1, "Select at least one country"),
  products : z.array(productItemSchema).min(1, "Select at least one product or variation"),
  steps    : z.array(stepSchema).min(1, "Add at least one step"),
})
type FormValues = z.infer<typeof formSchema>

interface Props {
  discountRuleData?: FormValues & {
    id: string
    countries: string[]
    products: { productId: string | null; variationId: string | null }[]
    steps: { fromUnits: number; toUnits: number; price: number }[]
  }
  isEditing?: boolean
}

export function DiscountRuleForm({ discountRuleData, isEditing = false }: Props) {
  const router = useRouter()
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      countries: [],
      products: [],
      steps: [{ fromUnits: 1, toUnits: 2, price: 0 }],
    },
  })
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "steps" })

  // --- Countries ---
  const [countryOptions, setCountryOptions] = useState<
    { value: string; label: string }[]
  >([]);
  useEffect(() => {
    fetch("/api/organizations/countries", {
      headers: {
        "x-internal-secret":
          process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "",
      },
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch countries");
        return res.json();
      })
      .then((data) => {
        const list: string[] = Array.isArray(data.countries)
          ? data.countries
          : JSON.parse(data.countries || "[]");
        setCountryOptions(
          list.map((c) => ({
            value: c.toUpperCase(),
            label:
              allCountries.find((co) => co.code === c.toUpperCase())
                ?.name || c,
          }))
        );
      })
      .catch((err) => toast.error(err.message));
  }, []);

  // Reset as soon as we have discountRuleData
  useEffect(() => {
    if (isEditing && discountRuleData) {
      form.reset({
        name     : discountRuleData.name,
        countries: discountRuleData.countries.map(c => c.toUpperCase()),
        products : discountRuleData.products,
        steps    : discountRuleData.steps,
      })
    }
  }, [isEditing, discountRuleData, form])

  // --- Categories (new) ---
  const [categoryOptions, setCategoryOptions] = useState<
    { value: string; label: string }[]
  >([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>(
    []
  );
  useEffect(() => {
    fetch("/api/product-categories")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load categories");
        return res.json();
      })
      .then((data) => {
        setCategoryOptions(
          data.categories.map((c: any) => ({
            value: c.id,
            label: c.name,
          }))
        );
      })
      .catch((err) => toast.error(err.message));
  }, []);

  // Whenever categories change, fetch all products in them and merge
  useEffect(() => {
    if (selectedCategories.length === 0) return;
    Promise.all(
      selectedCategories.map((catId) =>
        fetch(
          `/api/products?categoryId=${catId}&pageSize=1000`
        ).then((res) => {
          if (!res.ok) throw new Error("Failed to fetch products");
          return res.json();
        })
      )
    )
      .then((all) => {
        const items: { productId: string | null; variationId: string | null }[] =
          [];
        all.forEach((batch: any) => {
          batch.products.forEach((p: any) => {
            if (p.productType === "simple") {
              items.push({ productId: p.id, variationId: null });
            } else {
              p.variations.forEach((v: any) => {
                items.push({
                  productId: null,
                  variationId: v.id,
                });
              });
            }
          });
        });
        const existing = form.getValues("products");
        const map = new Map<string, { productId: string | null; variationId: string | null }>();
        existing.concat(items).forEach((it) => {
          const key = `${it.productId || ""}-${it.variationId || ""}`;
          map.set(key, it);
        });
        form.setValue("products", Array.from(map.values()));
      })
      .catch((err) => toast.error(err.message));
  }, [selectedCategories, form]);

  // --- Products / Variations ---
  const [productOptions, setProductOptions] = useState<
    { value: any; label: string }[]
  >([]);
  useEffect(() => {
    fetch("/api/products")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch products");
        return res.json();
      })
      .then((data) => {
        const opts: any[] = [];
        data.products.forEach((p: any) => {
          if (p.productType === "simple") {
            opts.push({
              value: { productId: p.id, variationId: null },
              label: p.title,
            });
          } else {
            p.variations.forEach((v: any) => {
              opts.push({
                value: { productId: null, variationId: v.id },
                label: `${p.title} (${Object.values(v.attributes).join(
                  ", "
                )})`,
              });
            });
          }
        });
        setProductOptions(opts);
      })
      .catch((err) => toast.error(err.message));
  }, []);

  const onSubmit = async (vals: FormValues) => {
    try {
      const url    = isEditing ? `/api/tier-pricing/${(discountRuleData as any).id}` : "/api/tier-pricing"
      const method = isEditing ? "PATCH" : "POST"
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(vals) })
      if (!res.ok) throw new Error("Save failed")
      toast.success(isEditing ? "Rule updated" : "Rule created")
      router.push("/discount-rules")
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  return (
    <Card className="w-full mx-auto">
      <CardContent className="pt-6">
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-6"
          >
            {/* Rule Name */}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Rule Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. 3+ Unit Discount" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Applicable Countries */}
            <FormField
              control={form.control}
              name="countries"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Applicable Countries</FormLabel>
                  <FormControl>
                    <Select
                      isMulti
                      options={countryOptions}
                      value={countryOptions.filter((o) =>
                        field.value.includes(o.value)
                      )}
                      onChange={(opts) =>
                        field.onChange(opts.map((o) => o.value))
                      }
                      formatOptionLabel={(o) => (
                        <div className="flex items-center gap-2">
                          <ReactCountryFlag
                            countryCode={o.value}
                            svg
                            style={{ width: 20 }}
                          />
                          <span>{o.label}</span>
                        </div>
                      )}
                    />
                  </FormControl>
                  <div className="mt-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        field.onChange(countryOptions.map((o) => o.value))
                      }
                    >
                      Select All
                    </Button>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Add by Category */}
            <FormItem>
              <FormLabel>Add Entire Category</FormLabel>
              <Select
                isMulti
                options={categoryOptions}
                placeholder="Select category(ies)…"
                value={categoryOptions.filter((o) =>
                  selectedCategories.includes(o.value)
                )}
                onChange={(opts) =>
                  setSelectedCategories(opts.map((o) => o.value))
                }
                className="mb-4"
              />
            </FormItem>

            {/* Products/Variations */}
            <FormField
              control={form.control}
              name="products"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Products or Variations</FormLabel>
                  <FormControl>
                    <Select
                      isMulti
                      options={productOptions}
                      getOptionValue={(o) =>
                        `${o.value.productId ?? ""}-${o.value.variationId ??
                          ""}`
                      }
                      getOptionLabel={(o) => o.label}
                      value={productOptions.filter((o) =>
                        field.value.some(
                          (v) =>
                            v.productId === o.value.productId &&
                            v.variationId === o.value.variationId
                        )
                      )}
                      onChange={(opts) =>
                        field.onChange(opts.map((o) => o.value))
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

              {/* Discount Steps */}
              <div className="space-y-2">
              <FormLabel>Price Steps</FormLabel>
              {fields.map((f, i) => (
                <div key={f.id} className="grid grid-cols-4 items-end gap-2">
                  {/* From units */}
                  <FormField
                    control={form.control}
                    name={`steps.${i}.fromUnits`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>From Units</FormLabel>
                        <FormControl><Input type="number" min={1} {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {/* To units */}
                  <FormField
                    control={form.control}
                    name={`steps.${i}.toUnits`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>To Units</FormLabel>
                        <FormControl><Input type="number" min={1} {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {/* New price */}
                  <FormField
                    control={form.control}
                    name={`steps.${i}.price`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>New Price</FormLabel>
                        <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button variant="destructive" onClick={() => remove(i)}>Delete</Button>
                </div>
              ))}
              <Button type="button" onClick={() => append({ fromUnits: 1, toUnits: 2, price: 0 })}>
                Add Step
              </Button>
            </div>

            {/* Submit */}
            <div className="flex justify-end">
              <Button type="submit">{isEditing ? "Update Rule" : "Create Rule"}</Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
