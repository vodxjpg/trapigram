/* -------------------------------------------------------------------------- */
/*  /src/app/(dashboard)/warehouses/share-links/[shareLinkId]/page.tsx        */
/* -------------------------------------------------------------------------- */
"use client";

import React, { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import Select from "react-select";
import { Trash2, Plus, ArrowLeft, AlertCircle, X } from "lucide-react";
import countriesLib from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";
import ReactCountryFlag from "react-country-flag";

countriesLib.registerLocale(enLocale);

/* -------------------------------------------------------------------------- */
/*  Type helpers                                                              */
/* -------------------------------------------------------------------------- */
type User = {
  /** *Always* the real primary-key string we want to store in the form */
  userId: string;
  email: string;
  name: string | null;
};

type StockItem = {
  productId: string;
  variationId: string | null;
  title: string;
  cost: Record<string, number>;
  status: string;
  country: string;
  quantity: number;
  productType: "simple" | "variable";
  categoryId: string | null;
  categoryName: string;
};

type SharedProduct = {
  id: string;
  productId: string;
  variationId: string | null;
  title: string;
  cost: Record<string, number>;
  productType: "simple" | "variable";
};

type ShareLink = {
  shareLinkId: string;
  warehouseId: string;
  warehouseName: string;
  token: string;
  status: string;
  recipients: User[];
  products: SharedProduct[];
  countries: string[];
  createdAt: string;
};

/* -------------------------------------------------------------------------- */
/*  Zod + form types                                                          */
/* -------------------------------------------------------------------------- */
const costSchema = z
  .record(z.string(), z.number().positive("Cost must be a positive number"))
  .optional();

const productSchema = z.object({
  productId: z.string().min(1, "Product is required"),
  variationId: z.string().nullable(),
  cost: costSchema,
});

const formSchema = z.object({
  recipientUserIds: z.array(z.string()).min(1, "Select at least one recipient"),
  products: z.array(productSchema).min(1, "Select at least one product"),
});

type FormValues = z.infer<typeof formSchema>;

/* -------------------------------------------------------------------------- */
/*  Utility: normalise a raw user object from the API into <User> ----------- */
/* -------------------------------------------------------------------------- */
/* -------------------------------------------------------------------------- */
function normaliseUser(raw: any): User {
  return {
    userId: raw.userId ?? raw.id ?? "",
    email: raw.email,
    name: raw.name ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/*  ★ FIX #1: tiny helpers for uniqueness & parent titles                    */
/* -------------------------------------------------------------------------- */
const pvKey = (s:{productId:string;variationId:string|null}) =>
  `${s.productId}-${s.variationId ?? "null"}`;

function uniqueParents(items: StockItem[]) {
  const map = new Map<string, StockItem>();
  for (const it of items) {
    const had = map.get(it.productId);
    if (!had || had.variationId !== null) map.set(it.productId, it);
  }
  return [...map.values()];
}

const stripVariation = (t: string) => t.split(" - ")[0];

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */
export default function EditShareLinkPage() {
  const router = useRouter();
  const { shareLinkId } = useParams() as Record<string, string>;
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  const [users, setUsers] = useState<User[]>([]);
  const [stock, setStock] = useState<StockItem[]>([]);
  const [countries, setCountries] = useState<string[]>([]);
  const [shareLink, setShareLink] = useState<ShareLink | null>(null);
  const [emailSearch, setEmailSearch] = useState("");
  const [stockError, setStockError] = useState<string | null>(null);
  const [selectedCountries, setSelectedCountries] = useState<
    Record<number, string[]>
  >({});
  const [loading, setLoading] = useState(true);

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

  /* ---------------------------------------------------------------------- */
  /*  Data fetch                                                             */
  /* ---------------------------------------------------------------------- */
  useEffect(() => {
    (async () => {
      try {
        /* ------------------------------------------------ share-link --- */
        const shareRes = await fetch(
          `/api/warehouses/share-links/${shareLinkId}`,
        );
        if (!shareRes.ok) throw new Error("Failed to load share link");
        const shareData: ShareLink = await shareRes.json();
        setShareLink(shareData);
        setCountries(shareData.countries);

        /* ------------------------------------------------ stock -------- */
        const stockRes = await fetch(
          `/api/warehouses/${shareData.warehouseId}/stock`,
          {
            headers: {
              "x-internal-secret": process.env
                .NEXT_PUBLIC_INTERNAL_API_SECRET as string,
            },
          },
        );
        if (!stockRes.ok)
          throw new Error(`Failed to fetch stock: ${stockRes.status}`);
        const stockData = await stockRes.json();
        setStock(stockData.stock);

        /* ------------------------------------------- form defaults ----- */
        form.reset({
          recipientUserIds: shareData.recipients.map((r) => r.userId),
          products: shareData.products.map((p) => ({
            productId: p.productId,
            variationId: p.variationId,
            cost: p.cost,
          })),
        });

        /* ----------------------------------- selected countries -------- */
        const initial: Record<number, string[]> = {};
        shareData.products.forEach((p, i) => {
          initial[i] =
            Object.keys(p.cost).length > 0
              ? Object.keys(p.cost)
              : [...shareData.countries];
        });
        setSelectedCountries(initial);

        /* ------------- cache recipients so they appear in the select --- */
        const userPromises = shareData.recipients.map((r) =>
          fetch(`/api/users/search?email=${encodeURIComponent(r.email)}`, {
            headers: {
              "x-internal-secret": process.env
                .NEXT_PUBLIC_INTERNAL_API_SECRET as string,
            },
          }).then((res) => res.json()),
        );
        const results = await Promise.all(userPromises);
        setUsers(
          results.flatMap((r) => (r.users ?? []).map(normaliseUser)),
        );
      } catch (e) {
        console.error(e);
        setStockError("Failed to load share link or stock. Please try again.");
        toast.error("Failed to load share link or stock");
      } finally {
        setLoading(false);
      }
    })();
  }, [shareLinkId, form]);

  /* ---------------------------------------------------------------------- */
  /*  Helpers                                                                */
  /* ---------------------------------------------------------------------- */
  const uniqBy = <T, K>(arr: T[], key: (t: T) => K) =>
    arr.filter((v, i, a) => a.findIndex((t) => key(t) === key(v)) === i);




  /** add every unique product/variation exactly once */
  const selectAllProducts = () => {
    const existing = form.getValues("products");
    const uniqStock = uniqBy(stock, pvKey);

    const toAdd = uniqStock
      .filter((it) => it.status !== "draft")
      .filter(
        (it) =>
          !existing.some(
            (p) =>
              p.productId === it.productId &&
              p.variationId === it.variationId
          ),
      );

  if (!toAdd.length) {
    toast.info("No more non-draft products to select.");
    return;
  }

    const newProducts = toAdd.map((item) => ({
      productId: item.productId,
      variationId: item.variationId,
      cost: Object.fromEntries(
        countries.map((c) => [c, (item.cost[c] ?? 0) + 10]),
      ),
    }));

    form.setValue("products", [...existing, ...newProducts]);

    setSelectedCountries((prev) => {
      const next: Record<number, string[]> = { ...prev };
      const start = Object.keys(prev).length;
      newProducts.forEach((_, i) => {
        next[start + i] = [...countries];
      });
      return next;
    });
  };

  const removeCountry = (pIdx: number, c: string) => {
    setSelectedCountries((prev) => ({
      ...prev,
      [pIdx]: prev[pIdx].filter((x) => x !== c),
    }));
    const cur = form.getValues(`products.${pIdx}.cost`) ?? {};
    const nxt = { ...cur };
    delete nxt[c];
    form.setValue(`products.${pIdx}.cost`, nxt);
    form.clearErrors(`products.${pIdx}.cost`);
  };

  const addCountry = (pIdx: number, c: string) => {
    setSelectedCountries((p) => ({ ...p, [pIdx]: [...p[pIdx], c] }));
    form.clearErrors(`products.${pIdx}.cost`);
  };

  // add near the top of the component
const handleEmailSearchEdit = async () => {
  if (!emailSearch) {
    setUsers([]);
    return;
  }
  try {
    const resp = await fetch(
      `/api/users/search?email=${encodeURIComponent(emailSearch)}`,
      { headers: { "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET! } }
    );
    if (!resp.ok) throw new Error("Failed to fetch users");
    const data = await resp.json();
    const norm = (data.users ?? []).map(normaliseUser);
    setUsers((prev) => uniqBy([...prev, ...norm], (u) => u.userId));
    if (!norm.length) toast.info("No users found");
  } catch {
    toast.error("Failed to load users");
  }
};


  /* ---------------------------------------------------------------------- */
  /*  Derived structures                                                    */
  /* ---------------------------------------------------------------------- */
    // only non-draft items
    const nonDraft = stock.filter((s) => s.status !== "draft");
    const uniqStock = uniqBy(nonDraft, pvKey);
    const groupedStock = uniqStock.reduce<Record<string, StockItem[]>>((acc, it) => {
      const cat = it.categoryName || "Uncategorized";
      ;(acc[cat] ??= []).push(it);
      return acc;
    }, {});
  
  const stockByProduct = stock.reduce((acc, it) => {
    const k = pvKey(it);
    if (!acc[k]) acc[k] = {};
    acc[k][it.country] = it.quantity;
    return acc;
  }, {} as Record<string, Record<string, number>>);

  /* ---------------------------------------------------------------------- */
  /*  Rendering                                                              */
  /* ---------------------------------------------------------------------- */
  if (loading) return <div className="p-6">Loading...</div>;

  if (stockError || !shareLink) {
    return (
      <div className="p-6">
        <Button
          variant="outline"
          onClick={() => router.push("/warehouses/share-links")}
          className="mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Share Links
        </Button>

        <Card>
          <CardHeader>
            <CardTitle>Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-destructive">
              {stockError || "Share link not found"}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* ----------------------------------------------------------------- */}
      {/*  Header                                                           */}
      {/* ----------------------------------------------------------------- */}
      <div className="flex items-center gap-4 mb-6">
        <Button
          variant="outline"
          onClick={() => router.push("/warehouses/share-links")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Share Links
        </Button>
        <h1 className="text-3xl font-bold">
          Edit Share Link for {shareLink.warehouseName}
        </h1>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/*  Card                                                              */}
      {/* ----------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Update Share Link</CardTitle>
          <p className="text-muted-foreground">
            Modify recipients, products, and specific countries for this share
            link.
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

          {/* ---------------------------------------------------------------- */}
          {/*  Form                                                            */}
          {/* ---------------------------------------------------------------- */}
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(async (values) => {
                /* (submit handler left unchanged for brevity) */
                /* ------------------------------------------------------------- */
                try {
                  const validationErrors: string[] = [];

                  values.products.forEach((product, idx) => {
                    const prodCountries = selectedCountries[idx] || [];
                    if (prodCountries.length === 0) {
                      validationErrors.push(
                        `Product ${idx + 1}: At least one country must be selected.`,
                      );
                      form.setError(`products.${idx}.cost`, {
                        type: "manual",
                        message: "At least one country must be selected.",
                      });
                      return;
                    }

                    const cleanedCost = product.cost
                      ? Object.fromEntries(
                          Object.entries(product.cost).filter(
                            ([, v]) => v !== undefined,
                          ),
                        )
                      : {};
                    const costCountries = Object.keys(cleanedCost);

                    if (costCountries.length === 0) {
                      validationErrors.push(
                        `Product ${
                          idx + 1
                        }: At least one country with a valid cost is required.`,
                      );
                      form.setError(`products.${idx}.cost`, {
                        type: "manual",
                        message:
                          "At least one country with a valid cost is required.",
                      });
                      return;
                    }

                    const missing = prodCountries.filter(
                      (c) => !costCountries.includes(c),
                    );
                    if (missing.length) {
                      validationErrors.push(
                        `Product ${
                          idx + 1
                        }: Costs are required for ${missing.join(", ")}`,
                      );
                      form.setError(`products.${idx}.cost`, {
                        type: "manual",
                        message: `Costs are required for ${missing.join(", ")}.`,
                      });
                    }
                  });

                  if (validationErrors.length) {
                    toast.error(
                      "Please fix the validation errors before submitting.",
                    );
                    return;
                  }

                  const cleanedValues = {
                    ...values,
                    products: values.products
                      // only keep those whose stock entry wasn’t draft
                      .filter((p) => {
                        const rec = stock.find(
                          (s) =>
                            s.productId === p.productId &&
                            s.variationId === p.variationId
                        );
                        return rec && rec.status !== "draft";
                      })
                      .map((p) => ({
                        ...p,
                        cost: p.cost
                          ? Object.fromEntries(
                              Object.entries(p.cost).filter(([, v]) => v !== undefined)
                            )
                          : {},
                      })),
                  };

                  const res = await fetch(
                                      `/api/warehouses/share-links/${shareLinkId}`,
                                      {
                                        method: "PUT",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify(cleanedValues),
                                      }
                                    );
                                    const body = await res.json();
if (!res.ok) {
  toast.error(body.error || `Failed to update share link`);
  return;
}
                 // ── grab the new token and show it ───────────────────────
                 const token = body.token;
                 const url = `${window.location.origin}/share/${token}`;
                 setShareUrl(url);
                 toast.success("Share link updated!");
                 // don’t redirect—you want them to copy.
                } catch (err) {
                  console.error(err);
                  toast.error(
                    `Failed to update share link: ${
                      err instanceof Error ? err.message : "Unknown error"
                    }`,
                  );
                }
              })}
              className="space-y-8"
            >
              {/* -------------------- Recipients --------------------------- */}
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
                       onKeyDown={(e) => {
                         if (e.key === "Enter") {
                           e.preventDefault();
                           handleEmailSearchEdit();
                         }
                       }}
                     />
                     <Button type="button" onClick={handleEmailSearchEdit}>
                       Search
                     </Button>
                      </div>

                      {users.length > 0 && (
                        <FormControl>
                          <Select
                            isMulti
                            options={users.map((u) => ({
                              value: u.userId,
                              label: u.name
                                ? `${u.name} (${u.email})`
                                : u.email,
                            }))}
                            value={users
                              .filter((u) => field.value.includes(u.userId))
                              .map((u) => ({
                                value: u.userId,
                                label: u.name
                                  ? `${u.name} (${u.email})`
                                  : u.email,
                              }))}
                            /* -------- recipients remove still works  */
                            onChange={(sel) =>
                              field.onChange(sel.map((o) => o.value))
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
                      disabled={!stock.length}
                    >
                      Select All Products
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        const idx = fields.length;
                        append({ productId: "", variationId: null, cost: {} });
                        setSelectedCountries((prev) => ({
                          ...prev,
                          [idx]: [...countries],
                        }));
                      }}
                      disabled={!stock.length}
                    >
                      <Plus className="h-4 w-4 mr-2" /> Add Product
                    </Button>
                  </div>
                </div>

                {/* ---------------- Table -------------------------------- */}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Variation</TableHead>
                      <TableHead>Costs &amp; Stock by Country</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {fields.map((f, idx) => {
                      const selectedProdId = form.watch(
                        `products.${idx}.productId`,
                      );
                      const selectedVarId = form.watch(
                        `products.${idx}.variationId`,
                      );

                      const selectedProd = stock.find(
                        (s) => s.productId === selectedProdId,
                      );
                      const isVariable =
                        selectedProd?.productType === "variable";

                           const variations = isVariable
                          ? uniqStock.filter(
                              (s) =>
                                s.productId === selectedProdId &&   // <-- use selectedProdId
                                s.variationId != null &&
                                s.status !== "draft"
                            )
                          : [];

                      /* cost / stock helpers ------------------------------ */
                      const stockKey = `${selectedProdId}-${
                        selectedVarId ?? "none"
                      }`;
                      const prodStock = stockByProduct[stockKey] || {};

                      const prodCountries =
                        selectedCountries[idx] || countries;
                      const availableCountries = countries.filter(
                        (c) => !prodCountries.includes(c),
                      );

                      const baseTitle = stripVariation(selectedProd?.title ?? "");

                      return (
                        <TableRow key={f.id}>
                          {/* ---------------- product select -------------- */}
                          <TableCell>
                            <FormField
                              control={form.control}
                              name={`products.${idx}.productId`}
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
                                        ...Object.entries(groupedStock).map(([cat, items]) => ({
                                          label: cat,
                                          options: uniqueParents(items /* already non-draft */ ).map((s) => ({
                                            value: s.productId,
                                            label: stripVariation(s.title),
                                          })),
                                        })),
                                      ]}
                                      value={
                                        field.value
                                          ? {
                                              value: field.value,
                                              label: baseTitle,
                                            }
                                          : null
                                      }
                                      onChange={(opt) => {
                                        field.onChange(opt?.value || "");
                                        form.setValue(
                                          `products.${idx}.variationId`,
                                          null,
                                        );
                                        form.setValue(
                                          `products.${idx}.cost`,
                                          {},
                                        );
                                        setSelectedCountries((prev) => ({
                                          ...prev,
                                          [idx]: [...countries],
                                        }));
                                      }}
                                      placeholder="Select product"
                                      isDisabled={!stock.length}
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </TableCell>

                          {/* ---------------- variation select ------------ */}
                          <TableCell>
                            {isVariable && (
                              <FormField
                                control={form.control}
                                name={`products.${idx}.variationId`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormControl>
                                      <Select
                                        options={variations.map((v) => {
                                          const label =
                                            v.title.includes(" - ")
                                              ? v.title
                                                  .split(" - ")
                                                  .slice(1)
                                                  .join(" - ")
                                                  .trim()
                                              : v.title;
                                          return {
                                            value: v.variationId!,
                                            label,
                                          };
                                        })}
                                        value={
                                          field.value
                                            ? (() => {
                                                const v = variations.find(
                                                  (x) =>
                                                    x.variationId ===
                                                    field.value,
                                                );
                                                if (!v) return null;
                                                const label = v.title.includes(
                                                  " - ",
                                                )
                                                  ? v.title
                                                      .split(" - ")
                                                      .slice(1)
                                                      .join(" - ")
                                                      .trim()
                                                  : v.title;
                                                return {
                                                  value: v.variationId!,
                                                  label,
                                                };
                                              })()
                                            : null
                                        }
                                        onChange={(opt) => {
                                          field.onChange(opt?.value || null);
                                          form.setValue(
                                            `products.${idx}.cost`,
                                            {},
                                          );
                                          setSelectedCountries((prev) => ({
                                            ...prev,
                                            [idx]: [...countries],
                                          }));
                                        }}
                                        placeholder="Select variation"
                                        isDisabled={!selectedProdId}
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            )}
                          </TableCell>

                          {/* ---------------- cost / stock inputs -------- */}
                          <TableCell>
                            <FormField
                              control={form.control}
                              name={`products.${idx}.cost`}
                              render={() => (
                                <FormItem>
                                  <div className="space-y-2">
                                    {prodCountries.map((c) => {
                                      const baseCost =
                                        selectedProd?.cost[c] ?? 0;
                                      const qty = prodStock[c] ?? 0;
                                      return (
                                        <div
                                          key={c}
                                          className="flex items-center gap-2"
                                        >
                                          <div className="flex-1">
                                            <FormField
                                              control={form.control}
                                              name={`products.${idx}.cost.${c}`}
                                              render={({ field }) => (
                                                <FormItem>
                                                  <FormLabel className="flex items-center">
                                                    <ReactCountryFlag
                                                      countryCode={c}
                                                      svg
                                                      style={{
                                                        width: "1em",
                                                        height: "1em",
                                                        marginRight: "8px",
                                                      }}
                                                    />
                                                    {countriesLib.getName(
                                                      c,
                                                      "en",
                                                    ) || c}{" "}
                                                    (Base {baseCost}, Stock{" "}
                                                    {qty})
                                                  </FormLabel>
                                                  <FormControl>
                                                    <Input
                                                      type="number"
                                                      min="0"
                                                      step="0.01"
                                                      placeholder={`Cost for ${c}`}
                                                      value={
                                                        field.value !==
                                                        undefined
                                                          ? field.value
                                                          : ""
                                                      }
                                                      onChange={(e) => {
                                                        field.onChange(
                                                          e.target.value
                                                            ? Number(
                                                                e.target.value,
                                                              )
                                                            : undefined,
                                                        );
                                                        if (e.target.value)
                                                          form.clearErrors(
                                                            `products.${idx}.cost`,
                                                          );
                                                      }}
                                                      disabled={!selectedProdId}
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
                                            onClick={() =>
                                              removeCountry(idx, c)
                                            }
                                            disabled={
                                              prodCountries.length <= 1 &&
                                              !availableCountries.length
                                            }
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
                                          options={availableCountries.map(
                                            (c) => ({
                                              value: c,
                                              label:
                                                countriesLib.getName(c, "en") ??
                                                c,
                                            }),
                                          )}
                                          onChange={(opt) => {
                                            if (opt)
                                              addCountry(idx, opt.value);
                                          }}
                                          placeholder="Select a country"
                                          isDisabled={!selectedProdId}
                                        />
                                      </FormItem>
                                    )}
                                  </div>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </TableCell>

                          {/* ---------------- actions -------------------- */}
                          <TableCell className="text-right">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                remove(idx);
                                setSelectedCountries((prev) => {
                                  const tmp = { ...prev };
                                  delete tmp[idx];
                                  return tmp;
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

              {/* ---------------- submit / cancel ------------------------- */}
              <div className="flex gap-4">
                <Button type="submit" disabled={!stock.length}>
                  Update Share Link
                </Button>
                <Button
                  variant="outline"
                  onClick={() => router.push("/warehouses/share-links")}
                >
                  Cancel
                </Button>
              </div>
              </form>

             {/* show the new URL *after* the inner <form> closes */}
             {shareUrl && (
               <Card className="mt-6">
                 <CardHeader>
                   <CardTitle>Your Share URL</CardTitle>
                 </CardHeader>
                 <CardContent className="flex items-center gap-2">
                   <Input value={shareUrl} readOnly />
                   <Button
                     onClick={() => {
                       navigator.clipboard.writeText(shareUrl);
                       toast.success("Copied!");
                     }}
                   >
                     Copy
                   </Button>
                 </CardContent>
               </Card>
             )}
           </Form>
        </CardContent>
      </Card>
    </div>
  );
}
