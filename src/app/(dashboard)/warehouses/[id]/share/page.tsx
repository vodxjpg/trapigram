/* -------------------------------------------------------------------------- */
/*  /src/app/(dashboard)/warehouses/[id]/share/page.tsx                       */
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
  id: string;
  email: string;
  name: string | null;
};

type StockItem = {
  productId: string;
  variationId: string | null;
  title: string;
  status: string;
  cost: Record<string, number>;
  country: string; // only meaningful for stock rows
  quantity: number; // only meaningful for stock rows
  productType: "simple" | "variable";
  categoryId: string | null;
  categoryName: string;
};

type ProductRow = {
  productId: string;
  variationId: string | null;
  cost: Record<string, number> | undefined;
};

/* -------------------------------------------------------------------------- */
/*  Validation schema                                                         */
/* -------------------------------------------------------------------------- */
const costSchema = z
  .record(z.string(), z.number().positive("Cost must be a positive number"))
  .optional();

const productSchema = z
  .object({
    productId: z.string().min(1, "Product is required"),
    variationId: z.string().nullable(),
    cost: costSchema,
  })
  .superRefine(() => {}); // dynamic validation handled in onSubmit

const formSchema = z.object({
  recipientUserIds: z.array(z.string()).min(1, "Select at least one recipient"),
  products: z.array(productSchema).min(1, "Select at least one product"),
});

type FormValues = z.infer<typeof formSchema>;

/* -------------------------------------------------------------------------- */
/*  Helper utilities                                                          */
/* -------------------------------------------------------------------------- */
const pvKey = (s: { productId: string; variationId: string | null }) =>
  `${s.productId}-${s.variationId ?? "null"}`;

/** keep exactly one row per productId, favouring the parent row if present */
function uniqueParents(items: StockItem[]) {
  const map = new Map<string, StockItem>();
  for (const it of items) {
    const existing = map.get(it.productId);
    if (!existing || existing.variationId !== null) map.set(it.productId, it);
  }
  return [...map.values()];
}

const stripVariation = (t: string) => t.split(" - ")[0];

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */
export default function ShareWarehousePage() {
  const router = useRouter();
  const { id: warehouseId } = useParams() as { id: string };

  // ── permissions ───────────────────────────────────────────────────────
  const { data: activeOrg } = authClient.useActiveOrganization();
  const orgId = activeOrg?.id ?? null;
  const {
    hasPermission: canShareWarehouse,
    isLoading: permLoading,
  } = useHasPermission(orgId, { warehouses: ["sharing"] });

  useEffect(() => {
    if (!permLoading && !canShareWarehouse) {
      router.replace("/warehouses");
    }
  }, [permLoading, canShareWarehouse, router]);

  if (permLoading || !canShareWarehouse) {
    return null;
  }
  // ──────────────────────────────────────────────────────────────────────

  /* ------------------------------ local state --------------------------- */
  const [users, setUsers] = useState<User[]>([]);
  const [stock, setStock] = useState<StockItem[]>([]);
  const [catalog, setCatalog] = useState<StockItem[]>([]);
  const [countries, setCountries] = useState<string[]>([]);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [emailSearch, setEmailSearch] = useState("");
  const [stockError, setStockError] = useState<string | null>(null);
  const [selectedCountries, setSelectedCountries] = useState<
    Record<number, string[]>
  >({});
  // pagination state for the selected-products table
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);

  /* ------------------------------ react-hook-form ---------------------- */
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { recipientUserIds: [], products: [] },
  });
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "products",
  });

  // keep current page in range if selection size changes or pageSize changes
  useEffect(() => {
    const total = fields.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (page > totalPages) setPage(totalPages);
    if (page < 1) setPage(1);
  }, [fields.length, page, pageSize]);

  /* ------------------------------ fetch stock -------------------------- */
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/warehouses/${warehouseId}/stock`, {
          headers: {
            "x-internal-secret":
              process.env.NEXT_PUBLIC_INTERNAL_API_SECRET as string,
          },
        });
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
        const data = await res.json();
        setStock(data.stock);
        setCountries(data.countries);
        setStockError(null);
      } catch (err) {
        console.error(err);
        setStockError("Failed to load warehouse stock. Please try again.");
        toast.error("Failed to load warehouse stock");
      }
    })();
  }, [warehouseId]);

  /* ------------------------------ fetch full catalog (all products) ---- */
  useEffect(() => {
    let cancelled = false;
    async function loadAllProducts() {
      try {
        const merged: StockItem[] = [];
        let p = 1;
        let totalPages = 1;
        do {
          const r = await fetch(
            `/api/products?page=${p}&pageSize=50&status=published`,
          );
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
              typeof prod.cost === "string"
                ? JSON.parse(prod.cost)
                : prod.cost ?? {};
            // parent row
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
                  typeof v.cost === "string"
                    ? JSON.parse(v.cost)
                    : v.cost ?? {};
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
        // Non-fatal; UI still works with stock-only fallback
      }
    }
    loadAllProducts();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ------------------------------ generic helpers ---------------------- */
  const uniqBy = <T, K>(arr: T[], key: (t: T) => K) =>
    arr.filter((v, i, a) => a.findIndex((t) => key(t) === key(v)) === i);

  /* ------------------------------ email search ------------------------- */
  const handleEmailSearch = async () => {
    if (!emailSearch) {
      setUsers([]);
      return;
    }
    try {
      const resp = await fetch(
        `/api/users/search?email=${encodeURIComponent(emailSearch)}`,
        {
          headers: {
            "x-internal-secret":
              process.env.NEXT_PUBLIC_INTERNAL_API_SECRET as string,
          },
        },
      );
      if (!resp.ok) throw new Error("Failed to fetch users");
      const data = await resp.json();
      setUsers(data.users);
      if (!data.users?.length) toast.info("No users found with that email");
    } catch (err) {
      console.error(err);
      toast.error("Failed to load users");
    }
  };

  /* ------------------------------ selection dataset -------------------- */
  const dataset = [...stock, ...catalog];
  const nonDraft = dataset.filter((s) => s.status !== "draft");
  const uniqStock = uniqBy(nonDraft, pvKey);

  const groupedStock = uniqStock.reduce<Record<string, StockItem[]>>(
    (acc, it) => {
      const cat = it.categoryName || "Uncategorized";
      (acc[cat] ??= []).push(it);
      return acc;
    },
    {},
  );

  // map of stock quantities by product+variation & country (only from stock)
  const stockByProduct = stock.reduce((acc, it) => {
    const k = pvKey(it);
    acc[k] ??= {};
    acc[k][it.country] = it.quantity;
    return acc;
  }, {} as Record<string, Record<string, number>>);

  // helper to reindex selectedCountries after removing a row (field indices shift)
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

  /* ------------------------------ add / select-all products ------------ */
  const addProduct = () => {
    const idx = fields.length;
    append({ productId: "", variationId: null, cost: {} });
    setSelectedCountries((p) => ({ ...p, [idx]: [...countries] }));
  };

  const selectAllProducts = () => {
    const existing = form.getValues("products");

    // Only non-draft, prefer parent rows; otherwise a single variation
    const parentsOrSingle = uniqueParents(
      uniqStock.filter((it) => it.status !== "draft"),
    );

    // Build new rows, ensuring: not already selected; include countries that have base cost (stock optional)
    const additions: ProductRow[] = [];
    for (const it of parentsOrSingle) {
      const already = existing.some(
        (p) => p.productId === it.productId && p.variationId === it.variationId,
      );
      if (already) continue;

      // Countries valid for this item: require base cost; stock is NOT required
      const allowedCountries = countries.filter(
        (c) => typeof it.cost[c] === "number",
      );
      if (!allowedCountries.length) continue; // nothing to share safely

      // Server requires sharedCost > baseCost; use base+10
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
      shouldTouch: false,
    });
    setSelectedCountries((prev) => {
      const next: Record<number, string[]> = { ...prev };
      additions.forEach((row, i) => {
        // only the allowed countries for this row (aligns with server validation)
        next[baseIndex + i] = Object.keys(row.cost ?? {});
      });
      return next;
    });
    toast.success(
      `Added ${additions.length} product${additions.length > 1 ? "s" : ""}.`,
    );
  };

  /* ------------------------------ country helpers ---------------------- */
  const removeCountry = (idx: number, c: string) => {
    setSelectedCountries((prev) => {
      const list = prev[idx] ?? [...countries];
      return { ...prev, [idx]: list.filter((x) => x !== c) };
    });
    const cur = form.getValues(`products.${idx}.cost`) ?? {};
    const nxt = { ...cur };
    delete nxt[c];
    form.setValue(`products.${idx}.cost`, nxt);
    form.clearErrors(`products.${idx}.cost`);
  };

  const addCountry = (idx: number, c: string) => {
    setSelectedCountries((prev) => {
      const list = prev[idx] ?? [...countries];
      return { ...prev, [idx]: [...list, c] };
    });
    form.clearErrors(`products.${idx}.cost`);
  };

  // ────────────────────────────────────────────────────────────────
  const onSubmit = async (values: FormValues) => {
    try {
      // — dynamic validation that ensures at least one country cost per row —
      for (const [i, p] of values.products.entries()) {
        const selCountries = Object.keys(p.cost ?? {});
        if (!selCountries.length) {
          form.setError(`products.${i}.cost`, {
            type: "manual",
            message: "Add at least one country cost",
          });
          throw new Error("validation-failed");
        }
      }

      // — call API to create the share link —
      const res = await fetch(`/api/warehouses/${warehouseId}/share-links`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret":
            process.env.NEXT_PUBLIC_INTERNAL_API_SECRET as string,
        },
        body: JSON.stringify(values),
      });

      const body = await res.json();

      if (!res.ok) {
        toast.error(body.error || "Failed to create share link");
        return;
      }

      setShareUrl(body.url);
      toast.success("Share link created!");
    } catch (err) {
      if ((err as any).message !== "validation-failed") {
        console.error(err);
        toast.error("Failed to create share link");
      }
    }
  };

  /* ------------------------------ JSX ---------------------------------- */
  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
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
            Select recipients, products, and specific countries to share via a
            private link.
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
                              handleEmailSearch();
                            }
                          }}
                        />
                        <Button type="button" onClick={handleEmailSearch}>
                          Search
                        </Button>
                      </div>
                      {users.length > 0 && (
                        <FormControl>
                          <Select
                            isMulti
                            options={users.map((u) => ({
                              value: u.id,
                              label: u.name ? `${u.name} (${u.email})` : u.email,
                            }))}
                            value={users
                              .filter((u) => field.value.includes(u.id))
                              .map((u) => ({
                                value: u.id,
                                label: u.name
                                  ? `${u.name} (${u.email})`
                                  : u.email,
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

              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <FormLabel>Products</FormLabel>
                  <div className="flex gap-3 items-center">
                    {/* pagination controls */}
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        Page {page} of{" "}
                        {Math.max(
                          1,
                          Math.ceil(Math.max(1, fields.length) / pageSize),
                        )}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page <= 1}
                        aria-label="Previous page"
                      >
                        Prev
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setPage((p) =>
                            Math.min(
                              Math.max(
                                1,
                                Math.ceil(Math.max(1, fields.length) / pageSize),
                              ),
                              p + 1,
                            )
                          )
                        }
                        disabled={
                          page >=
                          Math.max(
                            1,
                            Math.ceil(Math.max(1, fields.length) / pageSize),
                          )
                        }
                        aria-label="Next page"
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
                    <Button
                      type="button"
                      variant="outline"
                      onClick={selectAllProducts}
                      disabled={!uniqStock.length}
                    >
                      Select All Products
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={addProduct}
                      disabled={!uniqStock.length}
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
                    {(() => {
                      const start = (page - 1) * pageSize;
                      const end = start + pageSize;
                      const visible = fields.slice(start, end);
                      return visible.map((f, localIdx) => {
                        const idx = start + localIdx; // global index

                        const selProdId = form.watch(
                          `products.${idx}.productId`,
                        );
                        const selVarId = form.watch(
                          `products.${idx}.variationId`,
                        );

                        // find product entry (from merged dataset) for type/title/costs
                        const prodEntry =
                          uniqStock.find(
                            (s) =>
                              s.productId === selProdId &&
                              s.variationId === null,
                          ) ||
                          uniqStock.find((s) => s.productId === selProdId);

                        const isVariable =
                          prodEntry?.productType === "variable";

                        const variations = isVariable
                          ? uniqStock.filter(
                              (s) =>
                                s.productId === selProdId &&
                                s.variationId &&
                                s.status !== "draft",
                            )
                          : [];

                        const stockKey = pvKey({
                          productId: selProdId,
                          variationId: selVarId,
                        });
                        const prodStock = stockByProduct[stockKey] || {};

                        // Default allowed countries: those with a base cost
                        const baseCostSource =
                          selVarId
                            ? uniqStock.find(
                                (s) =>
                                  s.productId === selProdId &&
                                  s.variationId === selVarId,
                              )?.cost ?? {}
                            : uniqStock.find(
                                (s) =>
                                  s.productId === selProdId &&
                                  s.variationId === null,
                              )?.cost ?? {};

                        const defaultAllowed = countries.filter(
                          (c) => typeof baseCostSource[c] === "number",
                        );
                        const prodCountries =
                          selectedCountries[idx] ??
                          (defaultAllowed.length ? defaultAllowed : countries);

                        const availableCountries = countries.filter(
                          (c) => !prodCountries.includes(c),
                        );

                        const baseTitle = stripVariation(
                          prodEntry?.title ?? "",
                        );

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
                                              options: uniqueParents(
                                                items /* already non-draft */,
                                              ).map((s) => ({
                                                value: s.productId,
                                                label: stripVariation(s.title),
                                              })),
                                            }),
                                          ),
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
                                          const nextId = opt?.value || "";
                                          field.onChange(nextId);
                                          form.setValue(
                                            `products.${idx}.variationId`,
                                            null,
                                          );
                                          form.setValue(
                                            `products.${idx}.cost`,
                                            {},
                                          );
                                          // default to countries that have base cost
                                          const base =
                                            uniqStock.find(
                                              (s) =>
                                                s.productId === nextId &&
                                                s.variationId === null,
                                            )?.cost ?? {};
                                          const allowed = countries.filter(
                                            (c) => typeof base[c] === "number",
                                          );
                                          setSelectedCountries((p) => ({
                                            ...p,
                                            [idx]: allowed.length
                                              ? allowed
                                              : [...countries],
                                          }));
                                        }}
                                        placeholder="Select product"
                                        isDisabled={!uniqStock.length}
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
                                          options={variations.map((v) => ({
                                            value: v.variationId!,
                                            label: v.title.includes(" - ")
                                              ? v.title
                                                  .split(" - ")
                                                  .slice(1)
                                                  .join(" - ")
                                                  .trim()
                                              : v.title,
                                          }))}
                                          value={
                                            field.value
                                              ? (() => {
                                                  const v = variations.find(
                                                    (x) =>
                                                      x.variationId ===
                                                      field.value,
                                                  );
                                                  if (!v) return null;
                                                  const lbl = v.title.includes(
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
                                                    label: lbl,
                                                  };
                                                })()
                                              : null
                                          }
                                          onChange={(opt) => {
                                            const nextVar =
                                              opt?.value || null;
                                            field.onChange(nextVar);
                                            form.setValue(
                                              `products.${idx}.cost`,
                                              {},
                                            );
                                            // default to countries that have base cost on the selected variation
                                            const base =
                                              uniqStock.find(
                                                (s) =>
                                                  s.productId === selProdId &&
                                                  s.variationId === nextVar,
                                              )?.cost ?? {};
                                            const allowed = countries.filter(
                                              (c) =>
                                                typeof base[c] === "number",
                                            );
                                            setSelectedCountries((p) => ({
                                              ...p,
                                              [idx]: allowed.length
                                                ? allowed
                                                : [...countries],
                                            }));
                                          }}
                                          placeholder="Select variation"
                                          isDisabled={!selProdId}
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
                                          baseCostSource[c] ?? 0;
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
                                                                  e.target
                                                                    .value,
                                                                )
                                                              : undefined,
                                                          );
                                                          if (e.target.value)
                                                            form.clearErrors(
                                                              `products.${idx}.cost`,
                                                            );
                                                        }}
                                                        disabled={!selProdId}
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
                                              aria-label={`Remove ${c}`}
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
                                                    "en",
                                                  ) ?? c,
                                              }),
                                            )}
                                            onChange={(opt) =>
                                              opt && addCountry(idx, opt.value)
                                            }
                                            placeholder="Select a country"
                                            isDisabled={!selProdId}
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
                                aria-label="Remove row"
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
                    {fields.length === 0
                      ? 0
                      : (page - 1) * pageSize + 1}{" "}
                    – {Math.min(page * pageSize, fields.length)} of{" "}
                    {fields.length}
                  </span>
                </div>
              </div>

              {/* Share Link output */}
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
                          toast.success("Copied!");
                        }}
                      >
                        Copy
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Submit */}
              <div className="flex gap-4">
                <Button
                  type="submit"
                  disabled={!!shareUrl || !uniqStock.length}
                >
                  Create Share Link
                </Button>
                <Button
                  variant="outline"
                  onClick={() => router.push("/warehouses")}
                >
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
