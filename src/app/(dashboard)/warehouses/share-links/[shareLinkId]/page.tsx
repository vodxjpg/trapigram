/* -------------------------------------------------------------------------- */
/*  /src/app/(dashboard)/warehouses/share-links/[shareLinkId]/page.tsx        */
/* -------------------------------------------------------------------------- */
"use client";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";
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
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */
type User = {
  userId: string; // always the real PK we store in the form
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
/*  Validation schema                                                         */
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
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */
function normaliseUser(raw: any): User {
  return {
    userId: raw.userId ?? raw.id ?? "",
    email: raw.email,
    name: raw.name ?? null,
  };
}

const pvKey = (s: { productId: string; variationId: string | null }) =>
  `${s.productId}-${s.variationId ?? "null"}`;

const stripVariation = (t: string) => t.split(" - ")[0];

const uniqBy = <T, K>(arr: T[], key: (t: T) => K) =>
  arr.filter((v, i, a) => a.findIndex((t) => key(t) === key(v)) === i);

function uniqueParents(items: StockItem[]) {
  const map = new Map<string, StockItem>();
  for (const it of items) {
    const had = map.get(it.productId);
    if (!had || had.variationId !== null) map.set(it.productId, it);
  }
  return [...map.values()];
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */
export default function EditShareLinkPage() {
  const router = useRouter();
  const { shareLinkId } = useParams() as Record<string, string>;

  // ── permissions ───────────────────────────────────────────────────────
  const { data: activeOrg } = authClient.useActiveOrganization();
  const orgId = activeOrg?.id ?? null;
  const {
    hasPermission: canShareLinks,
    isLoading: permLoading,
  } = useHasPermission(orgId, { warehouses: ["sharing"] });

  useEffect(() => {
    if (!permLoading && !canShareLinks) {
      router.replace("/warehouses");
    }
  }, [permLoading, canShareLinks, router]);

  if (permLoading || !canShareLinks) {
    return null;
  }
  // ──────────────────────────────────────────────────────────────────────

  const [shareUrl, setShareUrl] = useState<string | null>(null);

  const [users, setUsers] = useState<User[]>([]);
  const [stock, setStock] = useState<StockItem[]>([]);     // live stock entries
  const [catalog, setCatalog] = useState<StockItem[]>([]); // full product catalog (incl. no-stock)
  const [countries, setCountries] = useState<string[]>([]);
  const [shareLink, setShareLink] = useState<ShareLink | null>(null);
  const [emailSearch, setEmailSearch] = useState("");
  const [stockError, setStockError] = useState<string | null>(null);
  const [selectedCountries, setSelectedCountries] = useState<
    Record<number, string[]>
  >({});
  const [loading, setLoading] = useState(true);

  // pagination state for the selected-products table
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);

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
  /*  Fetch share link + warehouse stock                                     */
  /* ---------------------------------------------------------------------- */
  useEffect(() => {
    (async () => {
      try {
        // share link
        const shareRes = await fetch(`/api/warehouses/share-links/${shareLinkId}`);
        if (!shareRes.ok) throw new Error("Failed to load share link");
        const shareData: ShareLink = await shareRes.json();
        setShareLink(shareData);
        setCountries(shareData.countries);

        // stock for that warehouse
        const stockRes = await fetch(
          `/api/warehouses/${shareData.warehouseId}/stock`,
          {
            headers: {
              "x-internal-secret": process.env
                .NEXT_PUBLIC_INTERNAL_API_SECRET as string,
            },
          }
        );
        if (!stockRes.ok)
          throw new Error(`Failed to fetch stock: ${stockRes.status}`);
        const stockData = await stockRes.json();
        setStock(stockData.stock);

        // form defaults
        form.reset({
          recipientUserIds: shareData.recipients.map((r) => r.userId),
          products:
            shareData.products.length > 0
              ? shareData.products.map((p) => ({
                  productId: p.productId,
                  variationId: p.variationId,
                  cost: p.cost,
                }))
              : [{ productId: "", variationId: null, cost: {} }],
        });

        // selected countries initialisation
        const initial: Record<number, string[]> = {};
        if (shareData.products.length > 0) {
          shareData.products.forEach((p, i) => {
            initial[i] =
              Object.keys(p.cost).length > 0
                ? Object.keys(p.cost)
                : [...shareData.countries];
          });
        } else {
          initial[0] = [...shareData.countries];
        }
        setSelectedCountries(initial);

        // cache recipients so they appear in the select
        const userPromises = shareData.recipients.map((r) =>
          fetch(`/api/users/search?email=${encodeURIComponent(r.email)}`, {
            headers: {
              "x-internal-secret": process.env
                .NEXT_PUBLIC_INTERNAL_API_SECRET as string,
            },
          }).then((res) => res.json())
        );
        const results = await Promise.all(userPromises);
        setUsers(results.flatMap((r) => (r.users ?? []).map(normaliseUser)));
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
  /*  Fetch full catalog so we can add products even without stock           */
  /* ---------------------------------------------------------------------- */
  useEffect(() => {
    let cancelled = false;
    async function loadAllProducts() {
      try {
        const merged: StockItem[] = [];
        let p = 1;
        let totalPages = 1;
        do {
          const r = await fetch(`/api/products?page=${p}&pageSize=50&status=published`);
          if (!r.ok) throw new Error(`Products fetch failed: ${r.status}`);
          const body = await r.json();
          totalPages = Number(body?.pagination?.totalPages ?? 1);
          const items = Array.isArray(body?.products) ? body.products : [];
          for (const prod of items) {
            const productId: string = prod.id;
            const productTitle: string = prod.title;
            const productStatus: string = prod.status;
            const productType: "simple" | "variable" = prod.productType;
            const baseCost: Record<string, number> =
              typeof prod.cost === "string" ? JSON.parse(prod.cost) : (prod.cost ?? {});
            // parent
            merged.push({
              productId,
              variationId: null,
              title: productTitle,
              status: productStatus,
              cost: baseCost,
              country: "",
              quantity: 0,
              productType,
              categoryId: null,
              categoryName: "All Products",
            });
            // variations
            if (productType === "variable" && Array.isArray(prod.variations)) {
              for (const v of prod.variations) {
                const vCost: Record<string, number> =
                  typeof v.cost === "string" ? JSON.parse(v.cost) : (v.cost ?? {});
                const vLabel = v.sku || v.id;
                merged.push({
                  productId,
                  variationId: v.id,
                  title: `${productTitle} - ${vLabel}`,
                  status: productStatus,
                  cost: vCost,
                  country: "",
                  quantity: 0,
                  productType,
                  categoryId: null,
                  categoryName: "All Products",
                });
              }
            }
          }
          p += 1;
        } while (p <= totalPages && !cancelled);
        if (!cancelled) setCatalog(merged);
      } catch (e) {
        console.error(e);
      }
    }
    loadAllProducts();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---------------------------------------------------------------------- */
  /*  Derived structures                                                     */
  /* ---------------------------------------------------------------------- */
  // allow products without stock by merging stock + catalog
  const dataset = [...stock, ...catalog];
  const nonDraft = dataset.filter((s) => s.status !== "draft");
  const uniqStockMerged = uniqBy(nonDraft, pvKey);

  const groupedStock = uniqStockMerged.reduce<Record<string, StockItem[]>>(
    (acc, it) => {
      const cat = it.categoryName || "Uncategorized";
      (acc[cat] ??= []).push(it);
      return acc;
    },
    {}
  );

  // live stock map (for qty display only)
  const stockByProduct = stock.reduce((acc, it) => {
    const k = pvKey(it);
    if (!acc[k]) acc[k] = {};
    acc[k][it.country] = it.quantity;
    return acc;
  }, {} as Record<string, Record<string, number>>);

  // keep current page in range when selection size / pageSize changes
  useEffect(() => {
    const total = form.getValues("products").length;
    const totalPages = Math.max(1, Math.ceil(Math.max(1, total) / pageSize));
    if (page > totalPages) setPage(totalPages);
    if (page < 1) setPage(1);
  }, [form, page, pageSize]);

  // reindex selectedCountries after a row is removed
  const reindexSelectedCountriesAfterRemove = (removedIndex: number) => {
    setSelectedCountries((prev) => {
      const next: Record<number, string[]> = {};
      Object.entries(prev)
        .map(([k, v]) => [Number(k), v] as [number, string[]])
        .sort((a, b) => a[0] - b[0])
        .forEach(([k, v]) => {
          if (k < removedIndex) next[k] = v;
          else if (k > removedIndex) next[k - 1] = v;
        });
      return next;
    });
  };

  /* ---------------------------------------------------------------------- */
  /*  Actions                                                                */
  /* ---------------------------------------------------------------------- */
  const handleEmailSearchEdit = async () => {
    if (!emailSearch) {
      setUsers([]);
      return;
    }
    try {
      const resp = await fetch(
        `/api/users/search?email=${encodeURIComponent(emailSearch)}`,
        {
          headers: {
            "x-internal-secret": process.env
              .NEXT_PUBLIC_INTERNAL_API_SECRET as string,
          },
        }
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

  /** Select every unique (non-draft) product/variation once (parents preferred for UI), even if no stock. */
  const selectAllProducts = () => {
    const existing = form.getValues("products");
    const parentsOrSingle = uniqueParents(uniqStockMerged);

    const additions: {
      productId: string;
      variationId: string | null;
      cost: Record<string, number>;
    }[] = [];

    for (const it of parentsOrSingle) {
      const already = existing.some(
        (p) => p.productId === it.productId && p.variationId === it.variationId
      );
      if (already) continue;

      // allowed countries = defined base cost (no stock required)
      const allowedCountries = countries.filter(
        (c) => typeof it.cost[c] === "number"
      );
      if (!allowedCountries.length) continue;

      // simple base+10 helper (matches your existing pattern)
      const cost: Record<string, number> = {};
      for (const c of allowedCountries) cost[c] = (it.cost[c] ?? 0) + 10;

      additions.push({
        productId: it.productId,
        variationId: it.variationId,
        cost,
      });
    }

    if (!additions.length) {
      toast.info("No more eligible products to select.");
      return;
    }

    const baseIndex = existing.length;
    form.setValue("products", [...existing, ...additions], {
      shouldDirty: true,
    });

    setSelectedCountries((prev) => {
      const next: Record<number, string[]> = { ...prev };
      additions.forEach((row, i) => {
        next[baseIndex + i] = Object.keys(row.cost);
      });
      return next;
    });

    toast.success(
      `Added ${additions.length} product${additions.length > 1 ? "s" : ""}.`
    );
  };

  const removeCountry = (pIdx: number, c: string) => {
    setSelectedCountries((prev) => ({
      ...prev,
      [pIdx]: (prev[pIdx] ?? []).filter((x) => x !== c),
    }));
    const cur = form.getValues(`products.${pIdx}.cost`) ?? {};
    const nxt = { ...cur };
    delete nxt[c];
    form.setValue(`products.${pIdx}.cost`, nxt);
    form.clearErrors(`products.${pIdx}.cost`);
  };

  const addCountry = (pIdx: number, c: string) => {
    setSelectedCountries((p) => ({
      ...p,
      [pIdx]: [...(p[pIdx] ?? []), c],
    }));
    form.clearErrors(`products.${pIdx}.cost`);
  };

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

  const productsCount = form.getValues("products").length;
  const totalPages = Math.max(1, Math.ceil(Math.max(1, productsCount) / pageSize));

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
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

      <Card>
        <CardHeader>
          <CardTitle>Update Share Link</CardTitle>
          <p className="text-muted-foreground">
            Modify recipients, products, and specific countries for this share
            link.
          </p>
        </CardHeader>

        <CardContent>
          {/* pagination controls */}
          <div className="mb-4 flex items-center justify-end gap-2">
            <span className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              Prev
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setPage((p) => Math.min(totalPages, p + 1))
              }
              disabled={page >= totalPages}
            >
              Next
            </Button>
            <label className="text-sm text-muted-foreground">
              &nbsp;| Per page:&nbsp;
              <select
                className="border rounded-md px-2 py-1 text-sm"
                value={pageSize}
                onChange={(e) => {
                  const newSize = Number(e.target.value);
                  setPageSize(newSize);
                  setPage(1);
                }}
              >
                <option value={5}>5</option>
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
              </select>
            </label>
          </div>

          {stockError && (
            <Alert variant="destructive" className="mb-6">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{stockError}</AlertDescription>
            </Alert>
          )}

          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(async (values) => {
                try {
                  const validationErrors: string[] = [];

                  values.products.forEach((product, idx) => {
                    const prodCountries = selectedCountries[idx] || [];
                    if (prodCountries.length === 0) {
                      validationErrors.push(
                        `Product ${idx + 1}: At least one country must be selected.`
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
                            ([, v]) => v !== undefined
                          )
                        )
                      : {};
                    const costCountries = Object.keys(cleanedCost);

                    if (costCountries.length === 0) {
                      validationErrors.push(
                        `Product ${
                          idx + 1
                        }: At least one country with a valid cost is required.`
                      );
                      form.setError(`products.${idx}.cost`, {
                        type: "manual",
                        message:
                          "At least one country with a valid cost is required.",
                      });
                      return;
                    }

                    const missing = prodCountries.filter(
                      (c) => !costCountries.includes(c)
                    );
                    if (missing.length) {
                      validationErrors.push(
                        `Product ${idx + 1}: Costs are required for ${missing.join(", ")}`
                      );
                      form.setError(`products.${idx}.cost`, {
                        type: "manual",
                        message: `Costs are required for ${missing.join(", ")}.`,
                      });
                    }
                  });

                  if (validationErrors.length) {
                    toast.error("Please fix the validation errors before submitting.");
                    return;
                  }

                  // allow products without stock, but exclude drafts using the merged dataset
                  const cleanedValues = {
                    ...values,
                    products: values.products
                      .filter((p) =>
                        uniqStockMerged.some(
                          (s) =>
                            s.productId === p.productId &&
                            s.variationId === p.variationId &&
                            s.status !== "draft"
                        )
                      )
                      .map((p) => ({
                        ...p,
                        cost: p.cost
                          ? Object.fromEntries(
                              Object.entries(p.cost).filter(
                                ([, v]) => v !== undefined
                              )
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

                  const token = body.token;
                  const url = `${window.location.origin}/share/${token}`;
                  setShareUrl(url);
                  toast.success("Share link updated!");
                } catch (err) {
                  console.error(err);
                  toast.error(
                    `Failed to update share link: ${
                      err instanceof Error ? err.message : "Unknown error"
                    }`
                  );
                }
              })}
              className="space-y-8"
            >
              {/* Recipients */}
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
                              label: u.name ? `${u.name} (${u.email})` : u.email,
                            }))}
                            value={users
                              .filter((u) => field.value.includes(u.userId))
                              .map((u) => ({
                                value: u.userId,
                                label: u.name ? `${u.name} (${u.email})` : u.email,
                              }))}
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

              {/* Products */}
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <FormLabel>Products</FormLabel>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={selectAllProducts}
                      disabled={!uniqStockMerged.length}
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
                      disabled={!uniqStockMerged.length}
                    >
                      <Plus className="h-4 w-4 mr-2" /> Add Product
                    </Button>
                  </div>
                </div>

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
                    {(() => {
                      const start = (page - 1) * pageSize;
                      const end = start + pageSize;
                      const visible = fields.slice(start, end);

                      return visible.map((f, localIdx) => {
                        const idx = start + localIdx;

                        const selectedProdId = form.watch(
                          `products.${idx}.productId`
                        );
                        const selectedVarId = form.watch(
                          `products.${idx}.variationId`
                        );

                        // Find parent + variant from merged dataset
                        const selectedParent = uniqStockMerged.find(
                          (s) =>
                            s.productId === selectedProdId &&
                            s.variationId === null
                        );
                        const selectedProd = selectedVarId
                          ? uniqStockMerged.find(
                              (s) =>
                                s.productId === selectedProdId &&
                                s.variationId === selectedVarId
                            )
                          : selectedParent;

                        const isVariable =
                          (selectedParent?.productType ??
                            selectedProd?.productType) === "variable";

                        const variations = isVariable
                          ? uniqStockMerged.filter(
                              (s) =>
                                s.productId === selectedProdId &&
                                s.variationId != null &&
                                s.status !== "draft"
                            )
                          : [];

                        // cost/stock helpers
                        const stockKey = pvKey({
                          productId: selectedProdId,
                          variationId: selectedVarId,
                        });
                        const prodStock = stockByProduct[stockKey] || {};

                        const prodCountries = selectedCountries[idx] || countries;
                        const availableCountries = countries.filter(
                          (c) => !prodCountries.includes(c)
                        );

                        const baseTitle = stripVariation(
                          selectedParent?.title ?? selectedProd?.title ?? ""
                        );

                        // base cost reference for inputs (variant->parent fallback)
                        const costRef =
                          (selectedVarId
                            ? uniqStockMerged.find(
                                (s) =>
                                  s.productId === selectedProdId &&
                                  s.variationId === selectedVarId
                              )?.cost
                            : uniqStockMerged.find(
                                (s) =>
                                  s.productId === selectedProdId &&
                                  s.variationId === null
                              )?.cost) || {};

                        return (
                          <TableRow key={f.id}>
                            {/* Product */}
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
                                          ...Object.entries(groupedStock).map(
                                            ([cat, items]) => ({
                                              label: cat,
                                              options: uniqueParents(items).map(
                                                (s) => ({
                                                  value: s.productId,
                                                  label: stripVariation(s.title),
                                                })
                                              ),
                                            })
                                          ),
                                        ]}
                                        value={
                                          field.value
                                            ? { value: field.value, label: baseTitle }
                                            : null
                                        }
                                        onChange={(opt) => {
                                          const val = opt?.value || "";
                                          field.onChange(val);
                                          form.setValue(
                                            `products.${idx}.variationId`,
                                            null
                                          );
                                          form.setValue(
                                            `products.${idx}.cost`,
                                            {}
                                          );
                                          // default to countries that have base cost (no stock requirement)
                                          const base =
                                            uniqStockMerged.find(
                                              (s) =>
                                                s.productId === val &&
                                                s.variationId === null
                                            )?.cost || {};
                                          const allowed = countries.filter(
                                            (c) => typeof base[c] === "number"
                                          );
                                          setSelectedCountries((prev) => ({
                                            ...prev,
                                            [idx]: allowed.length
                                              ? allowed
                                              : [...countries],
                                          }));
                                        }}
                                        placeholder="Select product"
                                        isDisabled={!uniqStockMerged.length}
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </TableCell>

                            {/* Variation */}
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
                                            const label = v.title.includes(" - ")
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
                                                      field.value
                                                  );
                                                  if (!v) return null;
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
                                                })()
                                              : null
                                          }
                                          onChange={(opt) => {
                                            const nextVar =
                                              (opt?.value as string) ?? null;
                                            field.onChange(nextVar);
                                            form.setValue(
                                              `products.${idx}.cost`,
                                              {}
                                            );
                                            // default to variant's base-cost countries (fallback to all)
                                            const vCost =
                                              uniqStockMerged.find(
                                                (s) =>
                                                  s.productId ===
                                                    selectedProdId &&
                                                  s.variationId === nextVar
                                              )?.cost || {};
                                            const allowed = countries.filter(
                                              (c) => typeof vCost[c] === "number"
                                            );
                                            setSelectedCountries((prev) => ({
                                              ...prev,
                                              [idx]: allowed.length
                                                ? allowed
                                                : [...countries],
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

                            {/* Costs */}
                            <TableCell>
                              <FormField
                                control={form.control}
                                name={`products.${idx}.cost`}
                                render={() => (
                                  <FormItem>
                                    <div className="space-y-2">
                                      {prodCountries.map((c) => {
                                        const baseCost =
                                          (costRef as Record<string, number>)[c] ??
                                          0;
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
                                                        "en"
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
                                                                  e.target.value
                                                                )
                                                              : undefined
                                                          );
                                                          if (e.target.value)
                                                            form.clearErrors(
                                                              `products.${idx}.cost`
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
                                                  countriesLib.getName(
                                                    c,
                                                    "en"
                                                  ) ?? c,
                                              })
                                            )}
                                            onChange={(opt) => {
                                              if (opt)
                                                addCountry(
                                                  idx,
                                                  (opt as any).value
                                                );
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

                            {/* Actions */}
                            <TableCell className="text-right">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  remove(idx);
                                  reindexSelectedCountriesAfterRemove(idx);
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      });
                    })()}
                  </TableBody>
                </Table>

                <div className="flex items-center justify-between mt-2 text-sm text-muted-foreground">
                  <span>
                    Showing{" "}
                    {productsCount === 0 ? 0 : (page - 1) * pageSize + 1} –{" "}
                    {Math.min(page * pageSize, productsCount)} of {productsCount}
                  </span>
                </div>
              </div>

              {/* Submit */}
              <div className="flex gap-4">
                <Button type="submit" disabled={!countries.length}>
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

            {/* Share URL (after submit) */}
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
