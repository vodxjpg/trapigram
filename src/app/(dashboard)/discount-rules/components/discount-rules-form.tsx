// src/app/(dashboard)/discount-rules/components/discount-rules-form.tsx
"use client"

import React, { useState, useEffect, useMemo, useRef } from "react"
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
  toUnits: z.coerce.number().min(1),
  price: z.coerce.number().positive(), // must be > 0
})
const productItemSchema = z
  .object({ productId: z.string().uuid().nullable(), variationId: z.string().uuid().nullable() })
  .refine(d => d.productId || d.variationId, { message: "Select either a product or a variation" })
const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  countries: z.array(z.string().length(2)).min(1, "Select at least one country"),
  products: z.array(productItemSchema).min(1, "Select at least one product or variation"),
  steps: z.array(stepSchema).min(1, "Add at least one step"),
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
      // NOTE: price must be positive – 0 would fail zod and block submit on mobile/desktop
      steps: [{ fromUnits: 1, toUnits: 2, price: 0.01 }],
    },
    mode: "onSubmit",
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
        if (!res.ok) throw new Error("Failed to fetch countries")
        return res.json()
      })
      .then((data) => {
        const list: string[] = Array.isArray(data.countries)
          ? data.countries
          : JSON.parse(data.countries || "[]")
        setCountryOptions(
          list.map((c) => ({
            value: c.toUpperCase(),
            label:
              allCountries.find((co) => co.code === c.toUpperCase())
                ?.name || c,
          }))
        )
      })
      .catch((err) => toast.error(err.message))
  }, [])

  // Reset as soon as we have discountRuleData
  useEffect(() => {
    if (isEditing && discountRuleData) {
      form.reset({
        name: discountRuleData.name,
        countries: discountRuleData.countries.map(c => c.toUpperCase()),
        products: discountRuleData.products,
        steps: discountRuleData.steps.map(s => ({
          ...s,
          // guard invalid zero price coming from old data
          price: s.price > 0 ? s.price : 0.01,
        })),
      })
    }
  }, [isEditing, discountRuleData, form])

  // Common react-select portal settings to avoid mobile overlay quirks
  const selectPortalProps = useMemo(() => ({
    menuPortalTarget: typeof window !== "undefined" ? document.body : undefined,
    menuPosition: "fixed" as const,
    styles: {
      menuPortal: (base: any) => ({ ...base, zIndex: 50_000 }),
    },
  }), [])

  // --- Categories (with pagination + search) ---
  const [categoryOptions, setCategoryOptions] = useState<{ value: string; label: string }[]>([])
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [catPage, setCatPage] = useState(1)
  const [catTotalPages, setCatTotalPages] = useState(1)
  const [catLoading, setCatLoading] = useState(false)
  const [catQuery, setCatQuery] = useState("")
  const catQueryRef = useRef("")

  const fetchCategoriesPage = async (page: number, query: string, append: boolean) => {
    setCatLoading(true)
    try {
      const params = new URLSearchParams()
      params.set("page", String(page))
      params.set("pageSize", "25")
      if (query.trim()) params.set("search", query.trim())
      const res = await fetch(`/api/product-categories?${params.toString()}`)
      if (!res.ok) throw new Error("Failed to load categories")
      const data = await res.json() as { categories: Array<{ id: string; name: string }>; totalPages: number; currentPage: number }
      const opts = data.categories.map(c => ({ value: c.id, label: c.name }))
      setCategoryOptions(prev => {
        const map = new Map<string, { value: string; label: string }>()
        ;(append ? [...prev, ...opts] : opts).forEach(o => map.set(o.value, o))
        return Array.from(map.values())
      })
      setCatTotalPages(data.totalPages || 1)
      setCatPage(data.currentPage || page)
    } catch (e: any) {
      toast.error(e.message || "Failed to load categories")
    } finally {
      setCatLoading(false)
    }
  }

  // Initial categories load
  useEffect(() => {
    fetchCategoriesPage(1, "", false)
  }, [])

  // React-select search with lightweight debounce
  const debounceTimer = useRef<number | null>(null)
  const handleCategoryInputChange = (input: string, { action }: { action: string }) => {
    if (action === "input-change") {
      const q = input || ""
      setCatQuery(q)
      if (debounceTimer.current) window.clearTimeout(debounceTimer.current)
      debounceTimer.current = window.setTimeout(() => {
        catQueryRef.current = q
        setCatPage(1)
        fetchCategoriesPage(1, q, false)
      }, 300)
    }
    return input
  }

  // Load-next-page when scrolled to bottom
  const handleCategoriesMenuBottom = () => {
    if (catLoading) return
    if (catPage >= catTotalPages) return
    const next = catPage + 1
    fetchCategoriesPage(next, catQueryRef.current, true)
  }

  // Whenever categories change, fetch all products in them and merge
  useEffect(() => {
    if (selectedCategories.length === 0) return

    // Helper to grab every page of products for one category
    async function fetchAllProductsInCategory(catId: string) {
      const collected: any[] = []
      let page = 1
      let totalPages = 1

      do {
        const url = `/api/products?categoryId=${catId}&pageSize=100&page=${page}`
        const res = await fetch(url)
        if (!res.ok) throw new Error("Failed to fetch products")
        const json = await res.json()
        collected.push(...json.products)
        totalPages = json.pagination.totalPages
        page++
      } while (page <= totalPages)

      return collected
    }

    ;(async () => {
      try {
        // 1) fetch each category’s full product list
        const batches = await Promise.all(
          selectedCategories.map((catId) =>
            fetchAllProductsInCategory(catId)
          )
        )

        // 2) flatten into one array
        const allItems = batches.flat()

        // 3) convert into your product/variation tuples
        const items: { productId: string | null; variationId: string | null }[] = []
        allItems.forEach((p: any) => {
          if (p.productType === "simple") {
            items.push({ productId: p.id, variationId: null })
          } else {
            p.variations.forEach((v: any) => {
              items.push({ productId: null, variationId: v.id })
            })
          }
        })

        // ─── also merge these into productOptions so <Select> can render them
        const newOpts = allItems.flatMap((p: any) =>
          p.productType === "simple"
            ? [{ value: { productId: p.id, variationId: null }, label: p.title }]
            : p.variations.map((v: any) => ({
                value: { productId: null, variationId: v.id },
                label: `${p.title} (${Object.values(v.attributes).join(", ")})`,
              }))
        )
        setProductOptions((prev) => {
          const map = new Map(prev.map(o => [`${o.value.productId || ""}-${o.value.variationId || ""}`, o]))
          newOpts.forEach(o => {
            const key = `${o.value.productId || ""}-${o.value.variationId || ""}`
            if (!map.has(key)) map.set(key, o)
          })
          return Array.from(map.values())
        })

        // 4) merge with anything already manually added
        const existing = form.getValues("products")
        const map = new Map<string, { productId: string | null; variationId: string | null }>()
        existing.concat(items).forEach((it) => {
          const key = `${it.productId || ""}-${it.variationId || ""}`
          map.set(key, it)
        })

        // 5) write back into the form
        form.setValue("products", Array.from(map.values()))
      } catch (err: any) {
        toast.error(err.message)
      }
    })()
  }, [selectedCategories, form])

  // --- Products / Variations ---
  const [productOptions, setProductOptions] = useState<
    { value: { productId: string | null; variationId: string | null }; label: string }[]
  >([])

  /** fetch **every** page so previously-saved items are guaranteed to be present */
  useEffect(() => {
    (async () => {
      try {
        const collected: any[] = []
        let page = 1, totalPages = 1
        do {
          const res = await fetch(`/api/products?page=${page}&pageSize=100`)
          if (!res.ok) throw new Error("Failed to fetch products")
          const json = await res.json()
          collected.push(...json.products)
          totalPages = json.pagination?.totalPages ?? 1
          page++
        } while (page <= totalPages)

        const opts: any[] = []
        collected.forEach((p: any) => {
          if (p.productType === "simple") {
            opts.push({ value: { productId: p.id, variationId: null }, label: p.title })
          } else {
            p.variations.forEach((v: any) => {
              opts.push({
                value: { productId: null, variationId: v.id },
                label: `${p.title} (${Object.values(v.attributes).join(", ")})`,
              })
            })
          }
        })

        setProductOptions(opts)
      } catch (err: any) {
        toast.error(err.message)
      }
    })()
  }, [])

  /** after both: rule loaded **and** options fetched → be sure options cover the saved items */
  useEffect(() => {
    if (!isEditing || !discountRuleData || productOptions.length === 0) return

    const missingOpts = discountRuleData.products
      .filter(
        (p) =>
          !productOptions.some(
            (o) =>
              o.value.productId === p.productId &&
              o.value.variationId === p.variationId
          )
      )
      .map((p) => ({
        value: { productId: p.productId, variationId: p.variationId },
        // fallback label – you can fetch the real title if you want
        label: "Previously selected item",
      }))

    if (missingOpts.length) {
      setProductOptions((prev) => [...prev, ...missingOpts])
    }
  }, [isEditing, discountRuleData, productOptions])

  const onSubmit = async (vals: FormValues) => {
    try {
      const url = isEditing ? `/api/tier-pricing/${(discountRuleData as any).id}` : "/api/tier-pricing"
      const method = isEditing ? "PATCH" : "POST"
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(vals) })
      if (!res.ok) throw new Error("Save failed")
      toast.success(isEditing ? "Rule updated" : "Rule created")
      router.push("/discount-rules")
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  // Utility: ensure mobile keyboards don’t keep a Select open over the submit button
  const closeOpenMenus = () => {
    // react-select closes its menu on blur; forcing blur helps on iOS
    if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
  }

  return (
    <Card className="w-full mx-auto">
      <CardContent className="pt-6">
        <Form {...form}>
          <form
            onSubmit={(e) => { closeOpenMenus(); form.handleSubmit(onSubmit)(e) }}
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
                        field.onChange(opts.map((o) => (o as any).value))
                      }
                      formatOptionLabel={(o: any) => (
                        <div className="flex items-center gap-2">
                          <ReactCountryFlag
                            countryCode={o.value}
                            svg
                            style={{ width: 20 }}
                          />
                          <span>{o.label}</span>
                        </div>
                      )}
                      {...selectPortalProps}
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

            {/* Add by Category (with pagination + search) */}
            <FormItem>
              <FormLabel>Add Entire Category</FormLabel>
              <Select
                isMulti
                options={categoryOptions}
                placeholder={catLoading ? "Loading categories…" : "Select category(ies)…"}
                value={categoryOptions.filter((o) =>
                  selectedCategories.includes(o.value)
                )}
                onChange={(opts) =>
                  setSelectedCategories((opts as any[]).map((o) => o.value))
                }
                onMenuScrollToBottom={handleCategoriesMenuBottom}
                onInputChange={handleCategoryInputChange}
                noOptionsMessage={() =>
                  catQuery.trim()
                    ? "No categories match your search"
                    : (catPage < catTotalPages ? "Scroll to load more…" : "No more categories")
                }
                isLoading={catLoading}
                {...selectPortalProps}
                // keep menu open while picking many
                closeMenuOnSelect={false}
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
                        field.onChange((opts as any[]).map((o) => o.value))
                      }
                      {...selectPortalProps}
                      closeMenuOnSelect={false}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Discount Step */}
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
                        <FormControl><Input inputMode="numeric" type="number" min={1} {...field} /></FormControl>
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
                        <FormControl><Input inputMode="numeric" type="number" min={1} {...field} /></FormControl>
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
                        <FormControl><Input inputMode="decimal" type="number" step="0.01" min={0.01} {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {/* IMPORTANT: prevent accidental submit from delete buttons */}
                  <Button type="button" variant="destructive" onClick={(e) => { e.preventDefault(); remove(i) }}>Delete</Button>
                </div>
              ))}
              <Button type="button" onClick={() => append({ fromUnits: 1, toUnits: 2, price: 0.01 })}>
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
