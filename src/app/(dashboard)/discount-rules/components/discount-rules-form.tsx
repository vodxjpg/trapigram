// src/app/(dashboard)/discount-rules/components/discount-rules-form.tsx
"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import ReactSelect from "react-select";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { X, Check } from "lucide-react";
import countriesLib from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";
import { getCountries } from "libphonenumber-js";
import ReactCountryFlag from "react-country-flag";

countriesLib.registerLocale(enLocale);
const allCountries = getCountries().map((c) => ({
  code: c,
  name: countriesLib.getName(c, "en") || c,
}));

const LOG = "[TierPricing/Form]";

/* ──────────────────────────────── */
/*  Schemas                         */
/* ──────────────────────────────── */
const stepSchema = z.object({
  fromUnits: z.coerce.number().min(1),
  toUnits: z.coerce.number().min(1),
  price: z.coerce.number().positive(), // must be > 0
});

/**
 * IMPORTANT: shared copies use non-UUID IDs like "PROD-xxxx"/"VAR-xxxx".
 * Accept any non-empty string or null. Do not require UUID.
 */
const productItemSchema = z
  .object({
    productId: z.string().min(1).nullable(),
    variationId: z.string().min(1).nullable(),
  })
  .refine((d) => d.productId || d.variationId, {
    message: "Select either a product or a variation",
  });

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  countries: z
    .array(z.string().length(2))
    .min(1, "Select at least one country"),
  products: z
    .array(productItemSchema)
    .min(1, "Select at least one product or variation"),
  steps: z.array(stepSchema).min(1, "Add at least one step"),
  // NEW: optional list of client IDs this rule applies to. If empty → applies to everyone.
  clients: z.array(z.string().min(1)).default([]),
});

type FormValues = z.infer<typeof formSchema>;

interface Props {
  discountRuleData?: {
    id: string;
    name: string;
    countries: string[];
    products: { productId: string | null; variationId: string | null }[];
    steps: { fromUnits: number; toUnits: number; price: number }[];
    clients?: string[];   // preferred (new API)
    customers?: string[]; // legacy (fallback)
  };
  isEditing?: boolean;
}

type Client = {
  id: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  email?: string;
  country?: string;
};

// Helper to merge client objects into a map by id
function upsertIntoMap(
  map: Record<string, Client>,
  clients: Client[]
): Record<string, Client> {
  const copy = { ...map };
  clients.forEach((c) => {
    if (c?.id) copy[c.id] = c;
  });
  return copy;
}

export function DiscountRuleForm({
  discountRuleData,
  isEditing = false,
}: Props) {
  const router = useRouter();
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      countries: [],
      products: [],
      steps: [{ fromUnits: 1, toUnits: 2, price: 0.01 }],
      clients: [],
    },
    mode: "onSubmit",
  });
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "steps",
  });

  // Initial debug of incoming props
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.debug(`${LOG} mount`, { isEditing, discountRuleData });
  }, [isEditing, discountRuleData]);

  /* ──────────────────────────────── */
  /*  Countries (ReactSelect multi)   */
  /* ──────────────────────────────── */
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
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`Failed to fetch countries (${res.status}) ${text}`);
        }
        return res.json();
      })
      .then((data) => {
        const list: string[] = Array.isArray(data.countries)
          ? data.countries
          : JSON.parse(data.countries || "[]");
        const opts = list.map((c) => ({
          value: c.toUpperCase(),
          label:
            allCountries.find((co) => co.code === c.toUpperCase())?.name || c,
        }));
        setCountryOptions(opts);
        // eslint-disable-next-line no-console
        console.debug(`${LOG} countries loaded`, { count: opts.length });
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error(`${LOG} countries error`, err);
        toast.error(err.message);
      });
  }, []);

  // Reset as soon as we have discountRuleData
  useEffect(() => {
    if (isEditing && discountRuleData) {
      form.reset({
        name: discountRuleData.name,
        countries: discountRuleData.countries.map((c) => c.toUpperCase()),
        products: discountRuleData.products,
        steps: discountRuleData.steps.map((s) => ({
          ...s,
          // guard invalid zero price coming from old data
          price: s.price > 0 ? s.price : 0.01,
        })),
        // Accept both shapes from the API, prefer the new 'clients'
        clients: Array.isArray(discountRuleData.clients)
          ? discountRuleData.clients
          : Array.isArray(discountRuleData.customers)
            ? discountRuleData.customers
            : [],
      });
      // eslint-disable-next-line no-console
      console.debug(`${LOG} form reset from loaded data`);
    }
  }, [isEditing, discountRuleData, form]);

  // Common react-select portal settings to avoid mobile overlay quirks
  const selectPortalProps = useMemo(
    () => ({
      menuPortalTarget:
        typeof window !== "undefined" ? document.body : undefined,
      menuPosition: "fixed" as const,
      styles: {
        menuPortal: (base: any) => ({ ...base, zIndex: 50_000 }),
      },
    }),
    []
  );

  /* ──────────────────────────────── */
  /*  Categories → add all products   */
  /* ──────────────────────────────── */
  const [categoryOptions, setCategoryOptions] = useState<
    { value: string; label: string }[]
  >([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [catPage, setCatPage] = useState(1);
  const [catTotalPages, setCatTotalPages] = useState(1);
  const [catLoading, setCatLoading] = useState(false);
  const [catQuery, setCatQuery] = useState("");
  const catQueryRef = useRef("");

  const fetchCategoriesPage = async (
    page: number,
    query: string,
    appendList: boolean
  ) => {
    setCatLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", "25");
      if (query.trim()) params.set("search", query.trim());
      const res = await fetch(`/api/product-categories?${params.toString()}`);
      if (!res.ok)
        throw new Error(`Failed to load categories (${res.status})`);
      const data = (await res.json()) as {
        categories: Array<{ id: string; name: string }>;
        totalPages: number;
        currentPage: number;
      };
      const opts = data.categories.map((c) => ({
        value: c.id,
        label: c.name,
      }));
      setCategoryOptions((prev) => {
        const map = new Map<string, { value: string; label: string }>();
        (appendList ? [...prev, ...opts] : opts).forEach((o) =>
          map.set(o.value, o)
        );
        return Array.from(map.values());
      });
      setCatTotalPages(data.totalPages || 1);
      setCatPage(data.currentPage || page);
      // eslint-disable-next-line no-console
      console.debug(`${LOG} categories page loaded`, {
        page: data.currentPage || page,
        totalPages: data.totalPages || 1,
        added: opts.length,
      });
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error(`${LOG} categories error`, e);
      toast.error(e.message || "Failed to load categories");
    } finally {
      setCatLoading(false);
    }
  };

  useEffect(() => {
    fetchCategoriesPage(1, "", false);
  }, []);

  const debounceTimer = useRef<number | null>(null);
  const handleCategoryInputChange = (
    input: string,
    { action }: { action: string }
  ) => {
    if (action === "input-change") {
      const q = input || "";
      setCatQuery(q);
      if (debounceTimer.current) window.clearTimeout(debounceTimer.current);
      debounceTimer.current = window.setTimeout(() => {
        catQueryRef.current = q;
        setCatPage(1);
        fetchCategoriesPage(1, q, false);
      }, 300);
    }
    return input;
  };

  const handleCategoriesMenuBottom = () => {
    if (catLoading) return;
    if (catPage >= catTotalPages) return;
    const next = catPage + 1;
    fetchCategoriesPage(next, catQueryRef.current, true);
  };

  // Whenever categories change, fetch all products in them and merge
  useEffect(() => {
    if (selectedCategories.length === 0) return;

    // Helper to grab every page of products for one category
    async function fetchAllProductsInCategory(catId: string) {
      const collected: any[] = [];
      let page = 1;
      let totalPages = 1;

      do {
        const url = `/api/products?categoryId=${catId}&pageSize=100&page=${page}`;
        const res = await fetch(url);
        if (!res.ok)
          throw new Error(`Failed to fetch products (${res.status})`);
        const json = await res.json();
        collected.push(...json.products);
        totalPages = json.pagination.totalPages;
        page++;
      } while (page <= totalPages);

      return collected;
    }

    (async () => {
      try {
        const batches = await Promise.all(
          selectedCategories.map((catId) => fetchAllProductsInCategory(catId))
        );
        const allItems = batches.flat();

        const items: {
          productId: string | null;
          variationId: string | null;
        }[] = [];
        allItems.forEach((p: any) => {
          if (p.productType === "simple") {
            items.push({ productId: p.id, variationId: null });
          } else {
            p.variations.forEach((v: any) => {
              items.push({ productId: null, variationId: v.id });
            });
          }
        });

        const newOpts = allItems.flatMap((p: any) =>
          p.productType === "simple"
            ? [
              {
                value: { productId: p.id, variationId: null },
                label: p.title,
              },
            ]
            : p.variations.map((v: any) => ({
              value: { productId: null, variationId: v.id },
              label: `${p.title} (${Object.values(v.attributes).join(", ")})`,
            }))
        );
        setProductOptions((prev) => {
          const map = new Map(
            prev.map((o) => [
              `${o.value.productId || ""}-${o.value.variationId || ""}`,
              o,
            ])
          );
          newOpts.forEach((o) => {
            const key = `${o.value.productId || ""}-${o.value.variationId || ""}`;
            if (!map.has(key)) map.set(key, o);
          });
          return Array.from(map.values());
        });

        const existing = form.getValues("products");
        const map = new Map<
          string,
          { productId: string | null; variationId: string | null }
        >();
        existing.concat(items).forEach((it) => {
          const key = `${it.productId || ""}-${it.variationId || ""}`;
          map.set(key, it);
        });

        form.setValue("products", Array.from(map.values()));
        // eslint-disable-next-line no-console
        console.debug(`${LOG} merged products from categories`, {
          categories: selectedCategories.length,
          added: items.length,
        });
      } catch (err: any) {
        // eslint-disable-next-line no-console
        console.error(`${LOG} products-from-categories error`, err);
        toast.error(err.message);
      }
    })();
  }, [selectedCategories, form]);

  /* ──────────────────────────────── */
  /*  Products / Variations (multi)   */
  /* ──────────────────────────────── */
  const [productOptions, setProductOptions] = useState<
    {
      value: { productId: string | null; variationId: string | null };
      label: string;
    }[]
  >([]);

  useEffect(() => {
    (async () => {
      try {
        const collected: any[] = [];
        let page = 1,
          totalPages = 1;
        do {
          const res = await fetch(`/api/products?page=${page}&pageSize=100`);
          if (!res.ok)
            throw new Error(`Failed to fetch products (${res.status})`);
          const json = await res.json();
          console.log(json)
          collected.push(...json.products);
          totalPages = json.pagination?.totalPages ?? 1;
          page++;
        } while (page <= totalPages);

        const opts: any[] = [];
        collected.forEach((p: any) => {
          if (p.productType === "simple") {
            opts.push({
              value: { productId: p.id, variationId: null },
              label: p.title,
            });
          } else {
            p.variations.forEach((v: any) => {
              opts.push({
                value: { productId: null, variationId: v.id },
                label: `${p.title} (${Object.values(v.attributes).join(", ")})`,
              });
            });
          }
        });

        setProductOptions(opts);
        // eslint-disable-next-line no-console
        console.debug(`${LOG} products loaded`, { options: opts.length });
      } catch (err: any) {
        // eslint-disable-next-line no-console
        console.error(`${LOG} products load error`, err);
        toast.error(err.message);
      }
    })();
  }, []);

  useEffect(() => {
    if (!isEditing || !discountRuleData || productOptions.length === 0) return;

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
        label: "Previously selected item",
      }));

    if (missingOpts.length) {
      setProductOptions((prev) => [...prev, ...missingOpts]);
      // eslint-disable-next-line no-console
      console.debug(`${LOG} added missing option stubs`, {
        count: missingOpts.length,
      });
    }
  }, [isEditing, discountRuleData, productOptions]);

  /* ──────────────────────────────── */
  /*  Customers (multi + search)      */
  /*  Matches the "Select + search"   */
  /*  pattern from order-form.tsx     */
  /* ──────────────────────────────── */
  const [allClients, setAllClients] = useState<Client[]>([]);
  // Cache for selected/known clients by id, ensures we can display names even if not present in paginated lists
  const [clientMap, setClientMap] = useState<Record<string, Client>>({});

  const [clientsLoading, setClientsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setResults] = useState<Client[]>([]);
  const [clientsOpen, setClientsOpen] = useState(false)
  const DEBOUNCE_MS = 400;

  const displayClient = (c: Client) => {
    const name = `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim();
    if (name && c.username) return `${name} (${c.username})`;
    return name || c.username || c.email || c.id;
  };

  // Resolve selected client IDs to client objects; try batch (?ids=) then fall back to per-id
  const resolveClientsByIds = useMemo(() => {
    const secret = process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "";
    return async (ids: string[]) => {
      const known = new Set<string>([
        ...Object.keys(clientMap),
        ...allClients.map((c) => c.id),
      ]);
      const missing = Array.from(new Set(ids)).filter((id) => !known.has(id));
      if (missing.length === 0) return;

      // 1) Try batch GET /api/clients?ids=comma,separated
      try {
        const res = await fetch(`/api/clients?ids=${encodeURIComponent(missing.join(","))}`, { headers: { "x-internal-secret": secret } });
        if (res.ok) {
          const js = await res.json();
          const arr: Client[] = js?.clients || js || [];
          if (Array.isArray(arr) && arr.length) setClientMap((m) => upsertIntoMap(m, arr));
        }
      } catch { /* no-op */ }

      // 2) Still missing? Try per-id endpoints /api/clients/:id
      const still = Array.from(new Set(ids)).filter(
        (id) => !clientMap[id] && !allClients.some((c) => c.id === id)
      );
      await Promise.all(still.map(async (id) => {
        try {
          const r = await fetch(`/api/clients/${id}`, { headers: { "x-internal-secret": secret } });
          if (r.ok) {
            const data = await r.json();
            const c: Client = data?.client ?? data;
            if (c?.id) setClientMap((m) => upsertIntoMap(m, [c]));
          }
        } catch { /* no-op */ }
      }));
    };
  }, [clientMap, allClients]);

  // Local filter so it reacts as you type immediately
  const filteredClients = useMemo(() => {
    if (searchTerm.trim().length < 3) return allClients;
    const t = searchTerm.toLowerCase();
    return allClients.filter(
      (c) =>
        c.username?.toLowerCase().includes(t) ||
        c.email?.toLowerCase().includes(t) ||
        `${c.firstName ?? ""} ${c.lastName ?? ""}`.toLowerCase().includes(t)
    );
  }, [allClients, searchTerm]);

  useEffect(() => {
    // load initial page of clients
    (async () => {
      setClientsLoading(true);
      try {
        const res = await fetch("/api/clients", {
          headers: {
            "x-internal-secret":
              process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "",
          },
        });
        const { clients: list } = await res.json();
        setAllClients(list || []);
        if (Array.isArray(list) && list.length) setClientMap((m) => upsertIntoMap(m, list));
      } catch {
        toast.error("Failed loading clients");
      } finally {
        setClientsLoading(false);
      }
    })();
  }, []);

  // Remote search (debounced) – same pattern used in the order form
  useEffect(() => {
    const q = searchTerm.trim();
    if (q.length < 3) {
      setResults([]);
      setSearching(false);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        setSearching(true);
        const url = `/api/clients?search=${encodeURIComponent(
          q
        )}&page=1&pageSize=10`;
        const res = await fetch(url, {
          headers: {
            "x-internal-secret":
              process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "",
          },
        });
        if (!res.ok) throw new Error("Search failed");
        const { clients: found } = await res.json();
        setResults(found || []);
        if (Array.isArray(found) && found.length) setClientMap((m) => upsertIntoMap(m, found));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // helper: add a client ID into the field value
  const addClientId = (id: string) => {
    const current = form.getValues("clients") || [];
    if (!current.includes(id)) {
      form.setValue("clients", [...current, id], { shouldDirty: true });
      // Try to resolve immediately if we have it in local pools
      const pool = [...allClients, ...searchResults];
      const found = pool.find((c) => c.id === id);
      if (found) setClientMap((m) => upsertIntoMap(m, [found]));
    }
  };

  // Whenever the selected client IDs change, resolve any missing labels
  const watchedClientIds = form.watch("clients");
  useEffect(() => {
    if (Array.isArray(watchedClientIds) && watchedClientIds.length) {
      resolveClientsByIds(watchedClientIds);
    }
  }, [watchedClientIds, resolveClientsByIds]);

  // Button label like "Add customers" / "2 selected"
  const clientsSummary = useMemo(() => {
    const ids = form.watch("clients") || [];
    if (ids.length === 0) return "Add customers";
    if (ids.length <= 2) {
      const labels = ids
        .map((id) => {
          const c =
            clientMap[id] ||
            allClients.find((x) => x.id === id) ||
            searchResults.find((x) => x.id === id);
          return c ? displayClient(c) : id;
        })
        .join(", ");
      return labels;
    }
    return `${ids.length} selected`;
  }, [form, allClients, searchResults, clientMap]);

  // Utility: ensure mobile keyboards don’t keep a Select open over the submit button
  const closeOpenMenus = () => {
    if (
      typeof document !== "undefined" &&
      document.activeElement instanceof HTMLElement
    ) {
      document.activeElement.blur();
    }
  };

  const readErrorBody = async (res: Response) => {
    try {
      const json = await res.json();
      return typeof json?.error === "string"
        ? json.error
        : JSON.stringify(json);
    } catch {
      try {
        return await res.text();
      } catch {
        return "";
      }
    }
  };

  const onSubmit = async (vals: FormValues) => {
    try {
      const url = isEditing
        ? `/api/tier-pricing/${(discountRuleData as any).id}`
        : "/api/tier-pricing";
      const method = isEditing ? "PATCH" : "POST";
      // eslint-disable-next-line no-console
      console.debug(`${LOG} submit ->`, { method, url, payload: vals });

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vals),
      });
      // eslint-disable-next-line no-console
      console.debug(`${LOG} response`, { status: res.status });

      if (!res.ok) {
        const body = await readErrorBody(res);
        // eslint-disable-next-line no-console
        console.error(`${LOG} save failed`, { status: res.status, body });
        throw new Error(body || "Save failed");
      }
      toast.success(isEditing ? "Rule updated" : "Rule created");
      router.push("/discount-rules");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <Card className="w-full mx-auto">
      <CardContent className="pt-6">
        <Form {...form}>
          <form
            onSubmit={(e) => {
              closeOpenMenus();
              form.handleSubmit(onSubmit)(e);
            }}
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

            {/* Scope: Countries */}
            <FormField
              control={form.control}
              name="countries"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Applicable Countries</FormLabel>
                  <FormControl>
                    <ReactSelect
                      isMulti
                      options={countryOptions}
                      value={countryOptions.filter((o) =>
                        field.value.includes(o.value)
                      )}
                      onChange={(opts) =>
                        field.onChange(opts.map((o: any) => o.value))
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

            {/* Scope: Customers (optional) */}
            <FormField
              control={form.control}
              name="clients"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Customers (optional){" "}
                    <span className="text-muted-foreground font-normal">
                      — leave empty to apply to everyone
                    </span>
                  </FormLabel>

                  {/* Selected list */}
                  <div className="flex flex-wrap gap-2">
                    {(field.value || []).length === 0 && (
                      <span className="text-sm text-muted-foreground">
                        No customers selected.
                      </span>
                    )}
                    {(field.value || []).map((id) => {
                      const obj =
                        clientMap[id] ||
                        allClients.find((c) => c.id === id) ||
                        searchResults.find((c) => c.id === id);
                      const label = obj ? displayClient(obj) : id;
                      return (
                        <Badge
                          key={id}
                          variant="secondary"
                          className="flex items-center gap-1"
                        >
                          {label}
                          <button
                            type="button"
                            onClick={() =>
                              field.onChange(
                                (field.value || []).filter((v) => v !== id)
                              )
                            }
                            aria-label="Remove customer"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      );
                    })}
                  </div>

                  {/* Multi-select (ReactSelect) with built-in search */}
                  <div className="mt-3">
                    {(() => {
                      // Build options: local filtered + remote (de-duped) excluding already selected
                      const selectedIds = new Set(field.value || []);
                      const local = filteredClients.filter(c => !selectedIds.has(c.id));
                      const remote = searchResults
                        .filter(c => !selectedIds.has(c.id) && !local.some(l => l.id === c.id));
                      const options = [...local, ...remote].map((c) => ({
                        value: c.id,
                        label: displayClient(c),
                      }));
                      // Selected values need labels for nice chips (we hide chips, but keep correct value shape)
                      const selectedOptions = (field.value || []).map((id) => {
                        const c =
                          clientMap[id] ||
                          allClients.find((x) => x.id === id) ||
                          searchResults.find((x) => x.id === id);
                        return { value: id, label: c ? displayClient(c) : id };
                      });
                      return (
                        <ReactSelect
                          isMulti
                          options={options}
                          value={selectedOptions}
                          onChange={(opts) => {
                            const ids = (opts as { value: string }[]).map((o) => o.value);
                            field.onChange(ids);
                            // Opportunistically upsert any known objects from local pools
                            const pool = [...allClients, ...searchResults];
                            const known = pool.filter((c) => ids.includes(c.id));
                            if (known.length) setClientMap((m) => upsertIntoMap(m, known));
                          }}
                          onInputChange={(val, meta) => {
                            if (meta.action === "input-change") setSearchTerm(val);
                          }}
                          isLoading={clientsLoading || searching}
                          closeMenuOnSelect={false}     // keep menu open to pick many
                          placeholder={
                            clientsLoading ? "Loading…" : "Search or pick clients…"
                          }
                          noOptionsMessage={() =>
                            (searchTerm.trim().length < 3)
                              ? "Type at least 3 characters to search"
                              : "No matches"
                          }
                          // Hide ReactSelect’s own chips; we show badges above instead.
                          components={{ MultiValue: () => null }}
                          {...selectPortalProps}
                        />
                      );
                    })()}
                    {(field.value || []).length > 0 && (
                      <div className="mt-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => field.onChange([])}
                        >
                          Clear all
                        </Button>
                      </div>
                    )}
                  </div>

                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Add by Category (with pagination + search) */}
            <FormItem>
              <FormLabel>Add Entire Category</FormLabel>
              <ReactSelect
                isMulti
                options={categoryOptions}
                placeholder={
                  catLoading ? "Loading categories…" : "Select category(ies)…"
                }
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
                    : catPage < catTotalPages
                      ? "Scroll to load more…"
                      : "No more categories"
                }
                isLoading={catLoading}
                {...selectPortalProps}
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
                    <ReactSelect
                      isMulti
                      options={productOptions}
                      getOptionValue={(o) =>
                        `${o.value.productId ?? ""}-${o.value.variationId ?? ""}`
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

            {/* Price Steps */}
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
                        <FormControl>
                          <Input inputMode="numeric" type="number" min={1} {...field} />
                        </FormControl>
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
                        <FormControl>
                          <Input inputMode="numeric" type="number" min={1} {...field} />
                        </FormControl>
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
                        <FormControl>
                          <Input
                            inputMode="decimal"
                            type="number"
                            step="0.01"
                            min={0.01}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {/* Delete row */}
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={(e) => {
                      e.preventDefault();
                      remove(i);
                    }}
                  >
                    Delete
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                onClick={() =>
                  append({ fromUnits: 1, toUnits: 2, price: 0.01 })
                }
              >
                Add Step
              </Button>
            </div>

            <Separator />

            {/* Submit */}
            <div className="flex justify-end">
              <Button type="submit">
                {isEditing ? "Update Rule" : "Create Rule"}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
