"use client";

import * as React from "react";
import Link from "next/link";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

/** External libs used in your shipping forms — mirrored here for consistency */
import Select from "react-select";
import countriesLib from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";
import { getCountries } from "libphonenumber-js";
import ReactCountryFlag from "react-country-flag";
import { slugify } from "@/lib/utils";

const ONBOARDING_REFRESH_EVENT = "onboarding:refresh";

/** Register the countries locale (same as your forms) */
countriesLib.registerLocale(enLocale);

/** Build the master countries list (ISO alpha-2) */
const allCountries = getCountries().map((code) => ({
    code,
    name: countriesLib.getName(code, "en") || code,
}));

type CountryOption = { value: string; label: string };

// at the top, add this export so the dashboard/reminder can address steps
export type StepKey =
    | "payment-method"
    | "shipping-company"
    | "shipping-method"
    | "product-category"
    | "product-attribute"
    | "attribute-term"
    | "products-team";

type PaymentMethod = {
    id: string;
    name: string;
    active: boolean;
};

export default function OnboardingDialog({
    open,
    onOpenChange,
    startAtKey,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    startAtKey?: StepKey | null;
}) {
    // Keep the last step (welcome) always last. Insert new steps before it.
    const coreSteps = [
        { id: 1, key: "payment-method", title: "Activate your payment method" },
        { id: 2, key: "shipping-company", title: "Create your shipping company" },
        { id: 3, key: "shipping-method", title: "Create your shipping method" },
        { id: 4, key: "product-category", title: "Create your first product category" },
        { id: 5, key: "product-attribute", title: "Create your first product attribute" }, // <— NEW step
        { id: 6, key: "attribute-term", title: "Create your first term" },
    ];
    const steps = React.useMemo(
        () => [...coreSteps, { id: 999, key: "products-team", title: "Welcome! You’re ready to start" }],
        []
    );
    const [stepIndex, setStepIndex] = React.useState<number>(0);
    const totalSteps = steps.length;
    const isFirst = stepIndex === 0;
    const isLast = stepIndex === totalSteps - 1;
    const progressValue = ((stepIndex + 1) / totalSteps) * 100;

    // ---- Open state is decided after initial server checks ----    
    const [initialized, setInitialized] = React.useState<boolean>(false);

    /** ---------- Shared: Organization countries (used by shipping steps) ---------- */
    const [countryOptions, setCountryOptions] = React.useState<CountryOption[]>([]);
    const [loadingOrgCountries, setLoadingOrgCountries] = React.useState<boolean>(true);

    // when startAtKey changes while opening, jump to that step
    React.useEffect(() => {
        if (!open || !startAtKey) return;
        const idx = steps.findIndex((s) => s.key === startAtKey);
        if (idx >= 0) setStepIndex(idx);
    }, [open, startAtKey, steps]);

    const isCompanyFormEmpty = () =>
        companyName.trim() === "" && selectedCompanyCountries.length === 0;

    const isMethodFormEmpty = () =>
        methodTitle.trim() === "" &&
        methodDescription.trim() === "" &&
        methodCountries.length === 0 &&
        minOrderCost.trim() === "" &&
        maxOrderCost.trim() === "" &&
        (shipmentCost.trim() === "" || shipmentCost.trim() === "0");

    const isCategoryFormEmpty = () =>
        catName.trim() === "" && catSlug.trim() === "";

    const isAttributeFormEmpty = () => attrName.trim() === "" && attrSlug.trim() === "";
    const isTermFormEmpty = () => termName.trim() === "" && termSlug.trim() === "";

    // Create term only if an attribute exists & user entered something
    const saveTermIfNeeded = async (): Promise<boolean> => {
        if (savingTerm) return false;
        // If there are no attributes, we can't create a term — treat as skipped.
        if (attrOptions.length === 0 || !selectedAttrId) return true;
        // Allow skip if blank
        if (isTermFormEmpty()) return true;

        if (!termName.trim()) { toast.error("Name is required"); return false; }
        if (!termSlug.trim()) { toast.error("Slug is required"); return false; }
        if (termSlugExists) { toast.error("This slug already exists"); return false; }

        try {
            setSavingTerm(true);
            const resp = await fetch(`/api/product-attributes/${selectedAttrId}/terms`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ name: termName.trim(), slug: termSlug.trim() }),
            });
            if (!resp.ok) {
                let msg = "Failed to save term";
                try { const j = await resp.json(); msg = j?.error || msg; } catch { }
                throw new Error(msg);
            }
            toast.success("Term created");
            // optional: clear inputs
            setTermName(""); setTermSlug("");
            // ping reminder/banner
            window.dispatchEvent(new Event("onboarding:refresh"));
            return true;
        } catch (e: any) {
            console.error(e);
            toast.error(e?.message || "Failed to save term");
            return false;
        } finally {
            setSavingTerm(false);
        }
    };


    React.useEffect(() => {
        let cancelled = false;
        async function fetchOrganizationCountries() {
            try {
                setLoadingOrgCountries(true);
                const res = await fetch(`/api/organizations/countries`, {
                    headers: { "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "" },
                });
                if (!res.ok) throw new Error("Failed to load countries");
                const data = await res.json();
                let codes: string[] = [];
                try {
                    const parsed = JSON.parse(data.countries);
                    if (Array.isArray(parsed)) codes = parsed;
                } catch {
                    codes = String(data.countries || "")
                        .split(",")
                        .map((c: string) => c.trim())
                        .filter(Boolean);
                }
                if (cancelled) return;
                const opts = codes.map((code) => {
                    const found = allCountries.find((c) => c.code === code);
                    return { value: code, label: found ? found.name : code };
                });
                setCountryOptions(opts);
            } catch (err: any) {
                console.error(err);
                toast.error(err?.message || "Could not load countries");
            } finally {
                if (!cancelled) setLoadingOrgCountries(false);
            }
        }
        fetchOrganizationCountries();
        return () => {
            cancelled = true;
        };
    }, []);

    /** ---------- Step 1 (Payment method) ---------- */
    // --- Step 1: Payment methods (list + activate) ---
    const [loadingPayments, setLoadingPayments] = React.useState<boolean>(true);
    const [paymentMethods, setPaymentMethods] = React.useState<PaymentMethod[]>([]);
    const [togglingId, setTogglingId] = React.useState<string | null>(null);

    // used by the rest of the onboarding logic to know if “payment” is satisfied
    const hasAnyPaymentMethod = paymentMethods.some((m) => m.active);
    const checkingExistingPayments = loadingPayments; // keep naming used elsewhere

    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                setLoadingPayments(true);
                // fetch ALL methods (not just active) — your table endpoint already supports this
                const res = await fetch("/api/payment-methods", { method: "GET" });
                if (!res.ok) throw new Error("Failed to load payment methods");
                const data = await res.json();
                if (!cancelled) {
                    const list: PaymentMethod[] = Array.isArray(data?.methods)
                        ? data.methods.map((m: any) => ({ id: m.id, name: m.name, active: !!m.active }))
                        : [];
                    setPaymentMethods(list);
                }
            } catch (err: any) {
                console.error(err);
                toast.error(err?.message || "Could not load payment methods");
            } finally {
                if (!cancelled) setLoadingPayments(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const togglePaymentActive = async (pm: PaymentMethod, nextActive: boolean) => {
        setTogglingId(pm.id);

        // optimistic update for just this row
        setPaymentMethods((prev) =>
            prev.map((m) => (m.id === pm.id ? { ...m, active: nextActive } : m))
        );

        try {
            const res = await fetch(`/api/payment-methods/${pm.id}/active`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ active: nextActive }),
            });
            if (!res.ok) throw new Error("Failed to update payment method");
            window.dispatchEvent(new Event("onboarding:refresh"));
        } catch (e) {
            // revert on error
            setPaymentMethods((prev) =>
                prev.map((m) => (m.id === pm.id ? { ...m, active: !nextActive } : m))
            );
            toast.error("Failed to update payment method");
        } finally {
            setTogglingId(null);
        }
    };

    /** ---------- Step 2 (Shipping company) ---------- */
    const [companyName, setCompanyName] = React.useState<string>("");
    const [selectedCompanyCountries, setSelectedCompanyCountries] = React.useState<string[]>([]);
    const [checkingExistingCompanies, setCheckingExistingCompanies] = React.useState<boolean>(true);
    const [hasAnyCompany, setHasAnyCompany] = React.useState<boolean>(false);
    const [savingCompany, setSavingCompany] = React.useState<boolean>(false);

    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                setCheckingExistingCompanies(true);
                const res = await fetch("/api/shipping-companies", { method: "GET" });
                if (!res.ok) throw new Error("Failed to check shipping companies");
                const data = await res.json();
                const { companies } = data;
                if (!cancelled) {
                    const exists = Array.isArray(companies) ? companies.length > 0 : !!companies?.length;
                    setHasAnyCompany(exists);
                }
            } catch (err: any) {
                console.error(err);
                toast.error(err?.message || "Could not verify existing shipping companies");
            } finally {
                if (!cancelled) setCheckingExistingCompanies(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const companyDisabled = hasAnyCompany || checkingExistingCompanies || savingCompany;

    const saveCompanyIfNeeded = async (): Promise<boolean> => {
        if (companyDisabled) return true;
        const trimmedName = companyName.trim();
        if (!trimmedName) {
            toast.error("Name is required");
            return false;
        }
        if (selectedCompanyCountries.length === 0) {
            toast.error("At least one country is required");
            return false;
        }
        const invalid = selectedCompanyCountries.find((c) => c.length !== 2);
        if (invalid) {
            toast.error(`Invalid country code: "${invalid}". Use alpha-2 codes like ES, FR, PT.`);
            return false;
        }

        try {
            setSavingCompany(true);
            const payload = {
                name: trimmedName,
                countries: JSON.stringify(selectedCompanyCountries),
            };
            const res = await fetch("/api/shipping-companies", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                let errMsg = "Request failed";
                try {
                    const err = await res.json();
                    errMsg = err?.error || errMsg;
                } catch { /* ignore */ }
                throw new Error(errMsg);
            }
            toast.success("Shipping company created successfully");
            window.dispatchEvent(new Event(ONBOARDING_REFRESH_EVENT));
            setHasAnyPaymentMethod(true);
            setHasAnyCompany(true);
            return true;
        } catch (err: any) {
            toast.error(err?.message || "Could not save shipping company");
            return false;
        } finally {
            setSavingCompany(false);
        }
    };

    /** ---------- Step 3 (Shipping method) ---------- */
    const [checkingExistingMethods, setCheckingExistingMethods] = React.useState<boolean>(true);
    const [hasAnyMethod, setHasAnyMethod] = React.useState<boolean>(false);
    const [savingMethod, setSavingMethod] = React.useState<boolean>(false);

    const [methodTitle, setMethodTitle] = React.useState<string>("");
    const [methodDescription, setMethodDescription] = React.useState<string>("");
    const [methodCountries, setMethodCountries] = React.useState<string[]>([]);
    const [minOrderCost, setMinOrderCost] = React.useState<string>("");
    const [maxOrderCost, setMaxOrderCost] = React.useState<string>("");
    const [shipmentCost, setShipmentCost] = React.useState<string>("0");

    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                setCheckingExistingMethods(true);
                const res = await fetch("/api/shipments", { method: "GET" });
                if (!res.ok) throw new Error("Failed to check shipments");
                const data = await res.json();
                const { shipments } = data;
                if (!cancelled) {
                    const exists = Array.isArray(shipments) ? shipments.length > 0 : !!shipments?.length;
                    setHasAnyMethod(exists);
                }
            } catch (err: any) {
                console.error(err);
                toast.error(err?.message || "Could not verify existing shipments");
            } finally {
                if (!cancelled) setCheckingExistingMethods(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const methodDisabled = hasAnyMethod || checkingExistingMethods || savingMethod;

    const saveMethodIfNeeded = async (): Promise<boolean> => {
        if (methodDisabled) return true;

        const title = methodTitle.trim();
        const description = methodDescription.trim();
        if (!title) {
            toast.error("Title is required");
            return false;
        }
        if (!description) {
            toast.error("Description is required");
            return false;
        }
        if (methodCountries.length === 0) {
            toast.error("Select at least one country");
            return false;
        }
        const invalid = methodCountries.find((c) => c.length !== 2);
        if (invalid) {
            toast.error(`Invalid country code: "${invalid}". Use alpha-2 codes like ES, FR, PT.`);
            return false;
        }

        const minVal = Number(minOrderCost);
        const maxVal = Number(maxOrderCost);
        const shipVal = Number(shipmentCost);

        if (Number.isNaN(minVal) || minVal < 0) {
            toast.error("Minimum order cost must be a number ≥ 0");
            return false;
        }
        if (Number.isNaN(maxVal) || maxVal < 0) {
            toast.error("Maximum order cost must be a number ≥ 0");
            return false;
        }
        if (!(minVal < maxVal)) {
            toast.error("Minimum order cost must be less than maximum order cost");
            return false;
        }
        if (Number.isNaN(shipVal) || shipVal < 0) {
            toast.error("Shipment cost must be a number ≥ 0");
            return false;
        }

        try {
            setSavingMethod(true);
            const payload = {
                title,
                description,
                countries: JSON.stringify(methodCountries),
                costs: JSON.stringify([{ minOrderCost: minVal, maxOrderCost: maxVal, shipmentCost: shipVal }]),
            };
            const res = await fetch("/api/shipments", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                let errMsg = "Request failed";
                try {
                    const err = await res.json();
                    errMsg = err?.error || errMsg;
                } catch { /* ignore */ }
                throw new Error(errMsg);
            }
            toast.success("Shipping method created successfully");
            window.dispatchEvent(new Event(ONBOARDING_REFRESH_EVENT));
            setHasAnyPaymentMethod(true);
            setHasAnyMethod(true);
            return true;
        } catch (err: any) {
            toast.error(err?.message || "Could not save shipping method");
            return false;
        } finally {
            setSavingMethod(false);
        }
    };

    /** ---------- Step 4 (Product category: name + slug with availability check) ---------- */
    const [checkingExistingCategories, setCheckingExistingCategories] = React.useState<boolean>(true);
    const [hasAnyCategory, setHasAnyCategory] = React.useState<boolean>(false);
    const [savingCategory, setSavingCategory] = React.useState<boolean>(false);

    const [catName, setCatName] = React.useState<string>("");
    const [catSlug, setCatSlug] = React.useState<string>("");
    const [slugChecking, setSlugChecking] = React.useState<boolean>(false);
    const [slugExists, setSlugExists] = React.useState<boolean>(false);
    const [slugTouched, setSlugTouched] = React.useState<boolean>(false);

    // check existing categories (disable inputs if any exist)
    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                setCheckingExistingCategories(true);
                const res = await fetch("/api/product-categories?pageSize=1", { credentials: "include" });
                if (!res.ok) throw new Error("Failed to fetch categories");
                const data = await res.json();
                const exists = Array.isArray(data?.categories) && data.categories.length > 0;
                if (!cancelled) setHasAnyCategory(exists);
            } catch (err: any) {
                console.error(err);
                toast.error(err?.message || "Could not verify existing categories");
            } finally {
                if (!cancelled) setCheckingExistingCategories(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const categoryDisabled = hasAnyCategory || checkingExistingCategories || savingCategory;

    const checkSlugExists = React.useCallback(async (raw: string, currentId?: string | null) => {
        const slug = slugify(raw);
        if (!slug) {
            setSlugExists(false);
            return;
        }
        setSlugChecking(true);
        try {
            const url = new URL("/api/product-categories/check-slug", window.location.origin);
            url.searchParams.append("slug", slug);
            if (currentId) url.searchParams.append("categoryId", currentId);
            const response = await fetch(url.toString(), { credentials: "include" });
            if (!response.ok) throw new Error("Failed to check slug");
            const data = await response.json();
            setSlugExists(Boolean(data?.exists));
        } catch (error) {
            console.error("Error checking slug:", error);
            toast.error("Failed to check slug availability");
            setSlugExists(false);
        } finally {
            setSlugChecking(false);
        }
    }, []);

    const onCategoryNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const name = e.target.value;
        setCatName(name);
        if (!slugTouched) {
            const generated = slugify(name);
            setCatSlug(generated);
            void checkSlugExists(generated);
        }
    };

    const onCategorySlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSlugTouched(true);
        const formatted = slugify(e.target.value);
        setCatSlug(formatted);
        void checkSlugExists(formatted);
    };

    const saveCategoryIfNeeded = async (): Promise<boolean> => {
        if (categoryDisabled) return true;
        if (!catName.trim()) {
            toast.error("Name is required");
            return false;
        }
        if (!catSlug.trim()) {
            toast.error("Slug is required");
            return false;
        }
        if (slugExists) {
            toast.error("This slug already exists. Please choose another one.");
            return false;
        }

        try {
            setSavingCategory(true);
            const res = await fetch("/api/product-categories", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ name: catName.trim(), slug: catSlug.trim() }),
            });
            if (!res.ok) {
                let msg = "Failed to save category";
                try {
                    const j = await res.json();
                    msg = j?.error || msg;
                } catch { /* ignore */ }
                throw new Error(msg);
            }
            toast.success("Category created successfully");
            window.dispatchEvent(new Event(ONBOARDING_REFRESH_EVENT));
            setHasAnyPaymentMethod(true);
            setHasAnyCategory(true);
            return true;
        } catch (err: any) {
            toast.error(err?.message || "Failed to save category");
            return false;
        } finally {
            setSavingCategory(false);
        }
    };

    // ---------- Step: Product attribute (name + slug with availability check) ----------
    const [checkingExistingAttributes, setCheckingExistingAttributes] = React.useState<boolean>(true);
    const [hasAnyAttribute, setHasAnyAttribute] = React.useState<boolean>(false);
    const [savingAttribute, setSavingAttribute] = React.useState<boolean>(false);

    const [attrName, setAttrName] = React.useState<string>("");
    const [attrSlug, setAttrSlug] = React.useState<string>("");
    const [attrSlugChecking, setAttrSlugChecking] = React.useState<boolean>(false);
    const [attrSlugExists, setAttrSlugExists] = React.useState<boolean>(false);

    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                setCheckingExistingAttributes(true);
                const res = await fetch("/api/product-attributes?pageSize=1", { credentials: "include" });
                if (!res.ok) throw new Error("Failed to fetch attributes");
                const data = await res.json();
                const exists = Array.isArray(data?.attributes) && data.attributes.length > 0;
                if (!cancelled) setHasAnyAttribute(exists);
            } catch (err: any) {
                console.error(err);
                toast.error(err?.message || "Could not verify existing attributes");
            } finally {
                if (!cancelled) setCheckingExistingAttributes(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const attributeDisabled = hasAnyAttribute || checkingExistingAttributes || savingAttribute;

    const checkAttrSlugExists = React.useCallback(async (raw: string) => {
        const slug = slugify(raw);
        if (!slug) { setAttrSlugExists(false); return; }
        setAttrSlugChecking(true);
        try {
            const url = new URL("/api/product-attributes/check-slug", window.location.origin);
            url.searchParams.append("slug", slug);
            const response = await fetch(url.toString(), { credentials: "include" });
            if (!response.ok) throw new Error("Failed to check slug");
            const data = await response.json();
            setAttrSlugExists(Boolean(data?.exists));
        } catch (error) {
            console.error("Error checking slug:", error);
            toast.error("Failed to check slug availability");
            setAttrSlugExists(false);
        } finally {
            setAttrSlugChecking(false);
        }
    }, []);

    const onAttributeNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const name = e.target.value;
        setAttrName(name);
        const generated = slugify(name);
        setAttrSlug(generated);
        void checkAttrSlugExists(generated);
    };

    const onAttributeSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const formatted = slugify(e.target.value);
        setAttrSlug(formatted);
        void checkAttrSlugExists(formatted);
    };

    const saveAttributeIfNeeded = async (): Promise<boolean> => {
        if (attributeDisabled) return true;
        if (!attrName.trim()) { toast.error("Name is required"); return false; }
        if (!attrSlug.trim()) { toast.error("Slug is required"); return false; }
        if (attrSlugExists) { toast.error("This slug already exists. Please choose another one."); return false; }

        try {
            setSavingAttribute(true);
            const res = await fetch("/api/product-attributes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ name: attrName.trim(), slug: attrSlug.trim() }),
            });
            if (!res.ok) {
                let msg = "Failed to save attribute";
                try { const j = await res.json(); msg = j?.error || msg; } catch { }
                throw new Error(msg);
            }
            toast.success("Attribute created successfully");
            window.dispatchEvent(new Event(ONBOARDING_REFRESH_EVENT));
            setHasAnyPaymentMethod(true);
            setHasAnyAttribute(true);
            return true;
        } catch (err: any) {
            toast.error(err?.message || "Failed to save attribute");
            return false;
        } finally {
            setSavingAttribute(false);
        }
    };

    // ---------- Step: Attribute Term (depends on attributes) ----------
    const [attrOptions, setAttrOptions] = React.useState<{ id: string; name: string }[]>([]);
    const [loadingAttrOptions, setLoadingAttrOptions] = React.useState<boolean>(true);
    const [selectedAttrId, setSelectedAttrId] = React.useState<string>("");

    const [termName, setTermName] = React.useState<string>("");
    const [termSlug, setTermSlug] = React.useState<string>("");
    const [termSlugChecking, setTermSlugChecking] = React.useState<boolean>(false);
    const [termSlugExists, setTermSlugExists] = React.useState<boolean>(false);
    const [savingTerm, setSavingTerm] = React.useState<boolean>(false)
    const [checkingExistingTerms, setCheckingExistingTerms] = React.useState<boolean>(true);
    const [hasAnyTerm, setHasAnyTerm] = React.useState<boolean>(false);

    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                setCheckingExistingTerms(true);
                // Need attributes to look for terms
                const aRes = await fetch("/api/product-attributes?pageSize=100", { credentials: "include" });
                if (!aRes.ok) throw new Error("Failed to load attributes");
                const aJson = await aRes.json();
                const attrs: Array<{ id: string }> = Array.isArray(aJson?.attributes) ? aJson.attributes : [];

                let found = false;
                // Check the first few attributes for at least one term
                for (let i = 0; i < Math.min(attrs.length, 25); i++) {
                    const id = attrs[i].id;
                    try {
                        const tRes = await fetch(`/api/product-attributes/${id}/terms?pageSize=1`, { credentials: "include" });
                        if (!tRes.ok) continue;
                        const tJson = await tRes.json();
                        const any = Array.isArray(tJson?.terms) ? tJson.terms.length > 0 : !!tJson?.terms?.length;
                        if (any) { found = true; break; }
                    } catch { /* ignore */ }
                }
                if (!cancelled) setHasAnyTerm(found);
            } catch (e) {
                if (!cancelled) setHasAnyTerm(false);
            } finally {
                if (!cancelled) setCheckingExistingTerms(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);


    // Load attributes list for the dropdown (uses same endpoint you already have)
    React.useEffect(() => {
        let cancelled = false;
        if (!open) return;

        (async () => {
            try {
                setLoadingAttrOptions(true);
                const res = await fetch("/api/product-attributes?pageSize=100", { credentials: "include" });
                if (!res.ok) throw new Error("Failed to fetch attributes");
                const data = await res.json();
                const items = Array.isArray(data?.attributes) ? data.attributes : [];
                if (cancelled) return;
                setAttrOptions(items.map((a: any) => ({ id: a.id, name: a.name })));
                // preselect first if none is selected
                if (!selectedAttrId && items.length > 0) setSelectedAttrId(items[0].id);
            } catch (e: any) {
                console.error(e);
                toast.error(e?.message || "Could not load attributes");
            } finally {
                if (!cancelled) setLoadingAttrOptions(false);
            }
        })();

        return () => { cancelled = true; };
    }, [open, hasAnyAttribute]); // re-run when an attribute is created

    const checkTermSlugExists = React.useCallback(async (raw: string) => {
        const slug = slugify(raw);
        if (!slug || !selectedAttrId) { setTermSlugExists(false); return; }
        setTermSlugChecking(true);
        try {
            const url = new URL(`/api/product-attributes/${selectedAttrId}/terms/check-slug`, window.location.origin);
            url.searchParams.append("slug", slug);
            const resp = await fetch(url.toString(), { credentials: "include" });
            if (!resp.ok) throw new Error("Failed to check slug");
            const data = await resp.json();
            setTermSlugExists(Boolean(data?.exists));
        } catch (err) {
            console.error(err);
            toast.error("Failed to check term slug availability");
            setTermSlugExists(false);
        } finally {
            setTermSlugChecking(false);
        }
    }, [selectedAttrId]);



    /** ---------- Completion control & initial step/open logic ---------- */

    // Mark complete when ALL creation steps are satisfied; if open, jump to the last (welcome) step once.
    React.useEffect(() => {
        const allDone =
            hasAnyPaymentMethod &&
            hasAnyCompany &&
            hasAnyMethod &&
            hasAnyCategory &&
            hasAnyAttribute &&
            hasAnyTerm;

        if (allDone) {
            try { localStorage.setItem("onboardingComplete", "true"); } catch { }
            window.dispatchEvent(new Event(ONBOARDING_REFRESH_EVENT));
            onOpenChange(false);
            if (open) setStepIndex(steps.length - 1); // move to final welcome step dynamically
        }
    }, [hasAnyPaymentMethod, hasAnyCompany, hasAnyMethod, hasAnyCategory, hasAnyAttribute, open, steps.length]);

    // Decide whether to open and which step to start from (first incomplete in order)
    React.useEffect(() => {
        if (initialized) return;
        const checksDone =
            !checkingExistingPayments &&
            !checkingExistingCompanies &&
            !checkingExistingMethods &&
            !checkingExistingCategories &&
            !checkingExistingAttributes &&
            !checkingExistingTerms; // ← add this;

        if (!checksDone) return;

        const firstIncompleteIndex =
            !hasAnyPaymentMethod ? steps.findIndex(s => s.key === "payment-method") :
                !hasAnyCompany ? steps.findIndex(s => s.key === "shipping-company") :
                    !hasAnyMethod ? steps.findIndex(s => s.key === "shipping-method") :
                        !hasAnyCategory ? steps.findIndex(s => s.key === "product-category") :
                            !hasAnyAttribute ? steps.findIndex(s => s.key === "product-attribute") :
                                !hasAnyTerm ? steps.findIndex(s => s.key === "attribute-term") : // ← add this
                                    -1;

        if (firstIncompleteIndex === -1) {
            try { localStorage.setItem("onboardingComplete", "true"); } catch { }
            window.dispatchEvent(new Event(ONBOARDING_REFRESH_EVENT));
            onOpenChange(false);
            setInitialized(true);
            return;
        }

        setStepIndex(firstIncompleteIndex);
        onOpenChange(true);
        setInitialized(true);
    }, [
        initialized,
        steps,
        checkingExistingPayments,
        checkingExistingCompanies,
        checkingExistingMethods,
        checkingExistingCategories,
        checkingExistingAttributes,
        hasAnyPaymentMethod,
        hasAnyCompany,
        hasAnyMethod,
        hasAnyCategory,
        hasAnyAttribute,
    ]);


    /** ---------- Navigation: Next performs creation when needed (no extra Save buttons) ---------- */
    const goBack = () => setStepIndex((i) => Math.max(i - 1, 0));

    const goNext = async () => {
        const currentKey = steps[stepIndex]?.key;

        let ok = true;
        if (currentKey === "payment-method") {
            if (!hasAnyPaymentMethod) {
                toast.error("Please activate a payment method to continue");
                return; // don't advance
            }
            ok = true; // nothing to save, we’re already patched on toggle
        } else if (currentKey === "shipping-company") {
            if (!companyDisabled && !isCompanyFormEmpty()) ok = await saveCompanyIfNeeded();
        } else if (currentKey === "shipping-method") {
            if (!methodDisabled && !isMethodFormEmpty()) ok = await saveMethodIfNeeded();
        } else if (currentKey === "product-category") {
            if (!categoryDisabled && !isCategoryFormEmpty()) ok = await saveCategoryIfNeeded();
        } else if (currentKey === "product-attribute") {
            if (!attributeDisabled && !isAttributeFormEmpty()) ok = await saveAttributeIfNeeded();
        } else if (currentKey === "attribute-term") {
            ok = await saveTermIfNeeded();
        }

        if (!ok) return;

        const atLast = stepIndex === steps.length - 1;
        if (atLast) {
            try { localStorage.setItem("onboardingComplete", "true"); } catch { }
            window.dispatchEvent(new Event("onboarding:refresh"));
            onOpenChange(false);
        } else {
            setStepIndex((i) => Math.min(i + 1, steps.length - 1));
        }
    };

    /** ---------- Render ---------- */
    const current = steps[stepIndex];

    /** Step content block placed ABOVE the progress bar */
    const renderStepContentAboveProgress = () => {
        switch (current.key) {
            case "payment-method":
                return (
                    <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                            Choose which payment method you want to use.
                        </p>

                        {loadingPayments ? (
                            <div className="text-sm text-muted-foreground">Loading payment methods…</div>
                        ) : paymentMethods.length === 0 ? (
                            <div className="rounded-md border p-3 text-sm">
                                No payment methods found. Create one in <Link href="/payment-methods" className="underline">Payments</Link>, then return here to activate it.
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {paymentMethods.map((pm) => (
                                    <div key={pm.id} className="flex items-center justify-between rounded-md border p-3">
                                        <div className="flex flex-col">
                                            <span className="text-sm font-medium">{pm.name}</span>
                                        </div>
                                        <Switch
                                            checked={pm.active}
                                            onCheckedChange={(checked) => togglePaymentActive(pm, checked)}
                                            disabled={togglingId !== null}
                                            id={`pm-switch-${pm.id}`}
                                        />
                                    </div>
                                ))}
                            </div>
                        )}

                        {!hasAnyPaymentMethod && !loadingPayments && paymentMethods.length > 0 && (
                            <p className="text-xs text-muted-foreground">
                                Activate one to continue.
                            </p>
                        )}
                    </div>
                );


            case "shipping-company":
                return (
                    <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                            Create your shipping company. If one already exists, fields will be disabled.
                        </p>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Name */}
                            <div className="flex flex-col space-y-2">
                                <Label htmlFor="shipping-name">Name *</Label>
                                <Input
                                    id="shipping-name"
                                    placeholder="Company name"
                                    value={companyName}
                                    onChange={(e) => setCompanyName(e.target.value)}
                                    disabled={companyDisabled}
                                />
                            </div>

                            {/* Countries multi-select (react-select with flags) */}
                            <div className="flex flex-col space-y-2">
                                <Label htmlFor="shipping-countries">Countries *</Label>
                                <Select
                                    inputId="shipping-countries"
                                    isMulti
                                    isDisabled={companyDisabled || loadingOrgCountries}
                                    options={countryOptions}
                                    value={countryOptions.filter((opt) =>
                                        selectedCompanyCountries.includes(opt.value)
                                    )}
                                    onChange={(opts) => {
                                        const arr = Array.isArray(opts) ? opts.map((o: any) => o.value) : [];
                                        setSelectedCompanyCountries(arr);
                                    }}
                                    placeholder={loadingOrgCountries ? "Loading countries..." : "Select country(s)"}
                                    formatOptionLabel={(opt: any) => (
                                        <div className="flex items-center gap-2">
                                            <ReactCountryFlag
                                                countryCode={opt.value}
                                                svg
                                                style={{ width: "1.25em", height: "1.25em" }}
                                            />
                                            <span>{opt.label}</span>
                                        </div>
                                    )}
                                    classNamePrefix="onboard-company-country"
                                />
                                <p className="text-[12px] text-muted-foreground">
                                    Use ISO 3166-1 alpha-2 codes (two letters).
                                </p>
                            </div>
                        </div>
                    </div>
                );

            case "shipping-method":
                return (
                    <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                            Create your shipping method. If one already exists, fields will be disabled.
                        </p>

                        {/* Row 1: Title & Description */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="flex flex-col space-y-2">
                                <Label htmlFor="method-title">Title *</Label>
                                <Input
                                    id="method-title"
                                    placeholder="Shipping method Title"
                                    value={methodTitle}
                                    onChange={(e) => setMethodTitle(e.target.value)}
                                    disabled={methodDisabled}
                                />
                            </div>
                            <div className="flex flex-col space-y-2">
                                <Label htmlFor="method-description">Description *</Label>
                                <Input
                                    id="method-description"
                                    placeholder="Shipping method Description"
                                    value={methodDescription}
                                    onChange={(e) => setMethodDescription(e.target.value)}
                                    disabled={methodDisabled}
                                />
                            </div>
                        </div>

                        {/* Row 2: Countries Multi-Select */}
                        <div className="flex flex-col space-y-2">
                            <Label htmlFor="method-countries">Countries *</Label>
                            <Select
                                inputId="method-countries"
                                isMulti
                                isDisabled={methodDisabled || loadingOrgCountries}
                                options={countryOptions}
                                value={countryOptions.filter((opt) =>
                                    methodCountries.includes(opt.value)
                                )}
                                onChange={(opts) => {
                                    const arr = Array.isArray(opts) ? opts.map((o: any) => o.value) : [];
                                    setMethodCountries(arr);
                                }}
                                placeholder={loadingOrgCountries ? "Loading countries..." : "Select country(s)"}
                                formatOptionLabel={(opt: any) => (
                                    <div className="flex items-center gap-2">
                                        <ReactCountryFlag
                                            countryCode={opt.value}
                                            svg
                                            style={{ width: "1.25em", height: "1.25em" }}
                                        />
                                        <span>{opt.label}</span>
                                    </div>
                                )}
                                classNamePrefix="onboard-method-country"
                            />
                        </div>

                        {/* Row 3: One Cost Group (no plus/minus here) */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="flex flex-col space-y-2">
                                <Label htmlFor="min-order-cost">Min Order Cost</Label>
                                <Input
                                    id="min-order-cost"
                                    type="number"
                                    inputMode="decimal"
                                    placeholder="0"
                                    value={minOrderCost}
                                    onChange={(e) => setMinOrderCost(e.target.value)}
                                    disabled={methodDisabled}
                                    className="appearance-none [&::-webkit-inner-spin-button]:hidden [&::-webkit-outer-spin-button]:hidden"
                                />
                            </div>
                            <div className="flex flex-col space-y-2">
                                <Label htmlFor="max-order-cost">Max Order Cost</Label>
                                <Input
                                    id="max-order-cost"
                                    type="number"
                                    inputMode="decimal"
                                    placeholder="0"
                                    value={maxOrderCost}
                                    onChange={(e) => setMaxOrderCost(e.target.value)}
                                    disabled={methodDisabled}
                                    className="appearance-none [&::-webkit-inner-spin-button]:hidden [&::-webkit-outer-spin-button]:hidden"
                                />
                            </div>
                            <div className="flex flex-col space-y-2">
                                <Label htmlFor="shipment-cost">Shipment Cost</Label>
                                <Input
                                    id="shipment-cost"
                                    type="number"
                                    inputMode="decimal"
                                    placeholder="0"
                                    value={shipmentCost}
                                    onChange={(e) => setShipmentCost(e.target.value)}
                                    disabled={methodDisabled}
                                    className="appearance-none [&::-webkit-inner-spin-button]:hidden [&::-webkit-outer-spin-button]:hidden"
                                />
                            </div>
                        </div>
                    </div>
                );

            case "product-category":
                return (
                    <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                            Create your first product category. If one already exists, fields will be disabled.
                        </p>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Name */}
                            <div className="flex flex-col space-y-2">
                                <Label htmlFor="cat-name">Name *</Label>
                                <Input
                                    id="cat-name"
                                    placeholder="Category name"
                                    value={catName}
                                    onChange={onCategoryNameChange}
                                    disabled={categoryDisabled}
                                />
                            </div>

                            {/* Slug (with availability check) */}
                            <div className="flex flex-col space-y-2">
                                <Label htmlFor="cat-slug">Slug *</Label>
                                <div className="relative">
                                    <Input
                                        id="cat-slug"
                                        placeholder="category-slug"
                                        value={catSlug}
                                        onChange={onCategorySlugChange}
                                        disabled={categoryDisabled}
                                    />
                                    {slugChecking && (
                                        <span className="absolute right-3 top-[9px] text-xs text-muted-foreground">
                                            Checking…
                                        </span>
                                    )}
                                </div>
                                <p className="text-xs">
                                    {slugChecking
                                        ? "Checking availability…"
                                        : slugExists
                                            ? <span className="text-destructive">This slug already exists.</span>
                                            : (catSlug ? <span className="text-green-600">This slug is available.</span> : "The URL-friendly identifier for this category.")}
                                </p>
                            </div>
                        </div>
                    </div>
                );
            case "product-attribute":
                return (
                    <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                            Create your first product attribute. If one already exists, fields will be disabled.
                        </p>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Name */}
                            <div className="flex flex-col space-y-2">
                                <Label htmlFor="attr-name">Name *</Label>
                                <Input
                                    id="attr-name"
                                    placeholder="e.g., Brand"
                                    value={attrName}
                                    onChange={onAttributeNameChange}
                                    disabled={attributeDisabled}
                                />
                            </div>

                            {/* Slug with availability check */}
                            <div className="flex flex-col space-y-2">
                                <Label htmlFor="attr-slug">Slug *</Label>
                                <div className="relative">
                                    <Input
                                        id="attr-slug"
                                        placeholder="e.g., brand"
                                        value={attrSlug}
                                        onChange={onAttributeSlugChange}
                                        disabled={attributeDisabled}
                                    />
                                    {attrSlugChecking && (
                                        <span className="absolute right-3 top-[9px] text-xs text-muted-foreground">Checking…</span>
                                    )}
                                </div>
                                <p className="text-xs">
                                    {attrSlugChecking
                                        ? "Checking availability…"
                                        : attrSlugExists
                                            ? <span className="text-destructive">This slug already exists.</span>
                                            : (attrSlug ? <span className="text-green-600">This slug is available.</span> : "The URL-friendly identifier.")}
                                </p>
                            </div>
                        </div>
                    </div>
                );

            case "attribute-term":
                return (
                    <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                            Create a term for an attribute. You must have at least one attribute created first.
                        </p>

                        {/* Row 1: Attribute dropdown */}
                        <div className="flex flex-col space-y-2">
                            <Label htmlFor="term-attribute">Attribute *</Label>
                            <select
                                id="term-attribute"
                                className="h-9 rounded-md border bg-background px-3 text-sm"
                                value={selectedAttrId}
                                onChange={(e) => setSelectedAttrId(e.target.value)}
                                disabled={loadingAttrOptions || attrOptions.length === 0}
                            >
                                {attrOptions.length === 0 ? (
                                    <option value="">No attributes available — create one first</option>
                                ) : (
                                    attrOptions.map((a) => (
                                        <option key={a.id} value={a.id}>{a.name}</option>
                                    ))
                                )}
                            </select>
                            {attrOptions.length === 0 && (
                                <p className="text-xs text-muted-foreground">
                                    Create an attribute in the previous step, then return here to add a term.
                                </p>
                            )}
                        </div>

                        {/* Row 2: Name & Slug */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="flex flex-col space-y-2">
                                <Label htmlFor="term-name">Name *</Label>
                                <Input
                                    id="term-name"
                                    placeholder="e.g., Nike"
                                    value={termName}
                                    onChange={(e) => {
                                        const v = e.target.value;
                                        setTermName(v);
                                        const s = slugify(v);
                                        setTermSlug(s);
                                        void checkTermSlugExists(s);
                                    }}
                                    disabled={attrOptions.length === 0}
                                />
                            </div>
                            <div className="flex flex-col space-y-2">
                                <Label htmlFor="term-slug">Slug *</Label>
                                <div className="relative">
                                    <Input
                                        id="term-slug"
                                        placeholder="e.g., nike"
                                        value={termSlug}
                                        onChange={(e) => {
                                            const s = slugify(e.target.value);
                                            setTermSlug(s);
                                            void checkTermSlugExists(s);
                                        }}
                                        disabled={attrOptions.length === 0}
                                    />
                                    {termSlugChecking && (
                                        <span className="absolute right-3 top-[9px] text-xs text-muted-foreground">Checking…</span>
                                    )}
                                </div>
                                <p className="text-xs">
                                    {termSlugChecking
                                        ? "Checking availability…"
                                        : termSlugExists
                                            ? <span className="text-destructive">This slug already exists.</span>
                                            : (termSlug ? <span className="text-green-600">This slug is available.</span> : "The URL-friendly identifier.")}
                                </p>
                            </div>
                        </div>
                    </div>
                );


            case "products-team":
                return (
                    <div className="space-y-4">
                        <h3 className="text-lg font-semibold">Welcome to your workspace 🎉</h3>
                        <p className="text-sm text-muted-foreground">
                            You’re all set. Create your first product to start selling.
                        </p>
                        <div className="flex justify-end">
                            <Button asChild>
                                <Link href="/products/new">Start creating a product</Link>
                            </Button>
                        </div>
                    </div>
                );

            default:
                return null;
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="sm:max-w-2xl"
                aria-describedby="onboarding-dialog-description"
            >
                <DialogHeader>
                    <DialogTitle className="text-xl">{current.title}</DialogTitle>
                    <DialogDescription id="onboarding-dialog-description">
                        Follow these steps to get your workspace ready.
                    </DialogDescription>
                </DialogHeader>

                {/* ABOVE the progress bar: inputs only (no Save buttons) */}
                <div className="flex flex-col gap-4 py-2">
                    {renderStepContentAboveProgress()}
                </div>

                <Separator />

                {/* Progress bar */}
                <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                        <p className="text-sm text-muted-foreground">
                            Step {stepIndex + 1} of {totalSteps}
                        </p>
                        <p className="text-sm font-medium">{Math.round(progressValue)}%</p>
                    </div>
                    <Progress value={progressValue} aria-label="Onboarding progress" />
                </div>

                {/* Navigation */}
                <div className="flex items-center justify-between">
                    <Button variant="outline" onClick={goBack} disabled={isFirst}>
                        Back
                    </Button>
                    <Button onClick={goNext}>
                        {isLast ? "Finish" : "Next"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
