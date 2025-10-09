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

/** Register the countries locale (same as your forms) */
countriesLib.registerLocale(enLocale);

/** Build the master countries list (ISO alpha-2) */
const allCountries = getCountries().map((code) => ({
    code,
    name: countriesLib.getName(code, "en") || code,
}));

type CountryOption = { value: string; label: string };

export default function OnboardingDialog() {
    // ---- Wizard steps ----
    const steps = React.useMemo(
        () => [
            { id: 1, key: "shipping-company", title: "Create your shipping company" },
            { id: 2, key: "shipping-method", title: "Create your shipping method" },
            { id: 3, key: "payment-method", title: "Create your payment method" },
            { id: 4, key: "products-team", title: "Welcome! You’re ready to start" },
        ],
        []
    );
    const [stepIndex, setStepIndex] = React.useState<number>(0);
    const totalSteps = steps.length;
    const isFirst = stepIndex === 0;
    const isLast = stepIndex === totalSteps - 1;
    const progressValue = ((stepIndex + 1) / totalSteps) * 100;

    // ---- Open state is decided after initial server checks ----
    const [open, setOpen] = React.useState<boolean>(false);
    const [initialized, setInitialized] = React.useState<boolean>(false);

    const goNext = () => {
        if (isLast) {
            // Finalize onboarding
            try {
                localStorage.setItem("onboardingComplete", "true");
            } catch {
                // ignore storage errors
            }
            setOpen(false);
            return;
        }
        setStepIndex((i) => Math.min(i + 1, totalSteps - 1));
    };

    const goBack = () => {
        setStepIndex((i) => Math.max(i - 1, 0));
    };

    /** ---------- Shared: Organization countries (used by step 1 & 2) ---------- */
    const [countryOptions, setCountryOptions] = React.useState<CountryOption[]>([]);
    const [loadingOrgCountries, setLoadingOrgCountries] = React.useState<boolean>(true);

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

    /** ---------- Step 1 state & effects (Shipping company) ---------- */
    const [companyName, setCompanyName] = React.useState<string>("");
    const [selectedCompanyCountries, setSelectedCompanyCountries] = React.useState<string[]>([]);
    const [checkingExistingCompanies, setCheckingExistingCompanies] = React.useState<boolean>(true);
    const [hasAnyCompany, setHasAnyCompany] = React.useState<boolean>(false);
    const [savingCompany, setSavingCompany] = React.useState<boolean>(false);

    React.useEffect(() => {
        // Check if at least one shipping company exists
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

    const handleSaveShippingCompany = async () => {
        if (companyDisabled) return;

        const trimmedName = companyName.trim();
        if (!trimmedName) {
            toast.error("Name is required");
            return;
        }
        if (selectedCompanyCountries.length === 0) {
            toast.error("At least one country is required");
            return;
        }
        const invalid = selectedCompanyCountries.find((c) => c.length !== 2);
        if (invalid) {
            toast.error(`Invalid country code: "${invalid}". Use alpha-2 codes like ES, FR, PT.`);
            return;
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
                } catch {
                    // ignore
                }
                throw new Error(errMsg);
            }
            toast.success("Shipping company created successfully");
            setHasAnyCompany(true); // lock fields after successful creation
        } catch (err: any) {
            console.error(err);
            toast.error(err?.message || "Could not save shipping company");
        } finally {
            setSavingCompany(false);
        }
    };

    /** ---------- Step 2 state & effects (Shipping method) ---------- */
    const [checkingExistingMethods, setCheckingExistingMethods] = React.useState<boolean>(true);
    const [hasAnyMethod, setHasAnyMethod] = React.useState<boolean>(false);
    const [savingMethod, setSavingMethod] = React.useState<boolean>(false);

    const [methodTitle, setMethodTitle] = React.useState<string>("");
    const [methodDescription, setMethodDescription] = React.useState<string>("");
    const [methodCountries, setMethodCountries] = React.useState<string[]>([]);
    // Single cost group (no plus/minus in onboarding step)
    const [minOrderCost, setMinOrderCost] = React.useState<string>("");
    const [maxOrderCost, setMaxOrderCost] = React.useState<string>("");
    const [shipmentCost, setShipmentCost] = React.useState<string>("0");

    React.useEffect(() => {
        // Check if at least one shipping method exists
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

    const handleSaveShippingMethod = async () => {
        if (methodDisabled) return;

        const title = methodTitle.trim();
        const description = methodDescription.trim();
        if (!title) {
            toast.error("Title is required");
            return;
        }
        if (!description) {
            toast.error("Description is required");
            return;
        }
        if (methodCountries.length === 0) {
            toast.error("Select at least one country");
            return;
        }
        const invalid = methodCountries.find((c) => c.length !== 2);
        if (invalid) {
            toast.error(`Invalid country code: "${invalid}". Use alpha-2 codes like ES, FR, PT.`);
            return;
        }

        // Numbers validation (mirroring your schema intent)
        const minVal = Number(minOrderCost);
        const maxVal = Number(maxOrderCost);
        const shipVal = Number(shipmentCost);

        if (Number.isNaN(minVal) || minVal < 0) {
            toast.error("Minimum order cost must be a number ≥ 0");
            return;
        }
        if (Number.isNaN(maxVal) || maxVal < 0) {
            toast.error("Maximum order cost must be a number ≥ 0");
            return;
        }
        if (!(minVal < maxVal)) {
            toast.error("Minimum order cost must be less than maximum order cost");
            return;
        }
        if (Number.isNaN(shipVal) || shipVal < 0) {
            toast.error("Shipment cost must be a number ≥ 0");
            return;
        }

        try {
            setSavingMethod(true);
            const payload = {
                title,
                description,
                countries: JSON.stringify(methodCountries),
                // costs as JSON string of an array with one cost group
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
                } catch {
                }
                throw new Error(errMsg);
            }
            toast.success("Shipping method created successfully");
            setHasAnyMethod(true); // lock fields after successful creation
        } catch (err: any) {
            console.error(err);
            toast.error(err?.message || "Could not save shipping method");
        } finally {
            setSavingMethod(false);
        }
    };

    /** ---------- Step 3 state & effects (Payment method) ---------- */
    const [checkingExistingPayments, setCheckingExistingPayments] = React.useState<boolean>(true);
    const [hasAnyPaymentMethod, setHasAnyPaymentMethod] = React.useState<boolean>(false);
    const [savingPayment, setSavingPayment] = React.useState<boolean>(false);

    const [pmName, setPmName] = React.useState<string>("");
    const [pmActive, setPmActive] = React.useState<boolean>(true);
    const [pmApiKey, setPmApiKey] = React.useState<string>("");
    const [pmSecretKey, setPmSecretKey] = React.useState<string>("");
    const [pmDescription, setPmDescription] = React.useState<string>("");

    React.useEffect(() => {
        // Check if at least one payment method exists
        let cancelled = false;
        (async () => {
            try {
                setCheckingExistingPayments(true);
                const res = await fetch("/api/payment-methods", { method: "GET" });
                if (!res.ok) throw new Error("Failed to check payment methods");
                const data = await res.json();
                const { methods } = data;
                if (!cancelled) {
                    const exists = Array.isArray(methods) ? methods.length > 0 : !!methods?.length;
                    setHasAnyPaymentMethod(exists);
                }
            } catch (err: any) {
                console.error(err);
                toast.error(err?.message || "Could not verify existing payment methods");
            } finally {
                if (!cancelled) setCheckingExistingPayments(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const paymentDisabled = hasAnyPaymentMethod || checkingExistingPayments || savingPayment;

    const handleSavePaymentMethod = async () => {
        if (paymentDisabled) return;

        if (!pmName.trim()) {
            toast.error("Name is required");
            return;
        }

        try {
            setSavingPayment(true);
            const payload: Record<string, any> = {
                name: pmName.trim(),
                active: pmActive,
                apiKey: pmApiKey.trim() || null,
                secretKey: pmSecretKey.trim() || null,
                description: pmDescription.trim() || null,
                // instructions intentionally omitted in onboarding step
            };

            const res = await fetch("/api/payment-methods", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            if (!res.ok) {
                let errMsg = "Failed to save";
                try {
                    const j = await res.json();
                    errMsg = j?.error || errMsg;
                } catch {
                    // ignore parse error
                }
                throw new Error(errMsg);
            }

            toast.success("Payment method created successfully");
            setHasAnyPaymentMethod(true); // lock fields after successful creation
        } catch (e: any) {
            toast.error(e?.message || "Failed to save");
        } finally {
            setSavingPayment(false);
        }
    };

    /** ---------- Completion control & initial step/open logic ---------- */

    // When any of the three flags change, if all are true we mark completion; inside the wizard we show step 4 once.
    React.useEffect(() => {
        const allDone = hasAnyCompany && hasAnyMethod && hasAnyPaymentMethod;
        if (allDone) {
            try {
                localStorage.setItem("onboardingComplete", "true");
            } catch {
                // ignore
            }
            // If the wizard is already open (user just finished the last missing item),
            // move to the welcome step so they see the CTA once.
            if (open) {
                setStepIndex(3);
            }
        }
    }, [hasAnyCompany, hasAnyMethod, hasAnyPaymentMethod, open]);

    // After all three checks finish the very first time, decide whether to open and where to start.
    React.useEffect(() => {
        if (initialized) return;
        const checksDone =
            !checkingExistingCompanies && !checkingExistingMethods && !checkingExistingPayments;

        if (!checksDone) return;

        const anyMissing =
            !hasAnyCompany || !hasAnyMethod || !hasAnyPaymentMethod;
        const allDone = !anyMissing;

        // Persist "complete" state if all done
        if (allDone) {
            try {
                localStorage.setItem("onboardingComplete", "true");
            } catch {
                // ignore
            }
        }

        // If any are missing, open at the first incomplete step. Otherwise, keep closed.
        if (anyMissing) {
            if (!hasAnyCompany) setStepIndex(0);
            else if (!hasAnyMethod) setStepIndex(1);
            else if (!hasAnyPaymentMethod) setStepIndex(2);
            setOpen(true);
        } else {
            setOpen(false);
        }

        setInitialized(true);
    }, [
        checkingExistingCompanies,
        checkingExistingMethods,
        checkingExistingPayments,
        hasAnyCompany,
        hasAnyMethod,
        hasAnyPaymentMethod,
        initialized,
    ]);

    /** ---------- Render ---------- */
    const current = steps[stepIndex];

    /** Step content block placed ABOVE the progress bar */
    const renderStepContentAboveProgress = () => {
        switch (current.key) {
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

                        <div className="flex justify-end">
                            <Button type="button" onClick={handleSaveShippingCompany} disabled={companyDisabled}>
                                {savingCompany ? "Saving..." : "Save"}
                            </Button>
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

                        <div className="flex justify-end">
                            <Button type="button" onClick={handleSaveShippingMethod} disabled={methodDisabled}>
                                {savingMethod ? "Saving..." : "Save"}
                            </Button>
                        </div>
                    </div>
                );

            case "payment-method":
                return (
                    <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                            Create your payment method. If one already exists, fields will be disabled.
                        </p>

                        {/* Name */}
                        <div className="flex flex-col space-y-2">
                            <Label htmlFor="pm-name">Name *</Label>
                            <Input
                                id="pm-name"
                                placeholder="Payment name"
                                value={pmName}
                                onChange={(e) => setPmName(e.target.value)}
                                disabled={paymentDisabled}
                            />
                        </div>

                        {/* Active */}
                        <div className="flex items-center gap-3">
                            <Switch
                                id="pm-active"
                                checked={pmActive}
                                onCheckedChange={setPmActive}
                                disabled={paymentDisabled}
                            />
                            <span className="text-sm">{pmActive ? "Active" : "Inactive"}</span>
                        </div>

                        {/* API key & Secret key */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="flex flex-col space-y-2">
                                <Label htmlFor="pm-api">API key</Label>
                                <Input
                                    id="pm-api"
                                    placeholder="Optional"
                                    value={pmApiKey}
                                    onChange={(e) => setPmApiKey(e.target.value)}
                                    disabled={paymentDisabled}
                                />
                            </div>
                            <div className="flex flex-col space-y-2">
                                <Label htmlFor="pm-secret">Secret key</Label>
                                <Input
                                    id="pm-secret"
                                    placeholder="Optional"
                                    value={pmSecretKey}
                                    onChange={(e) => setPmSecretKey(e.target.value)}
                                    disabled={paymentDisabled}
                                />
                            </div>
                        </div>

                        {/* Description */}
                        <div className="flex flex-col space-y-2">
                            <Label htmlFor="pm-description">Description</Label>
                            <Textarea
                                id="pm-description"
                                placeholder="Short text for admins (optional)"
                                value={pmDescription}
                                onChange={(e) => setPmDescription(e.target.value)}
                                className="min-h-[80px]"
                                disabled={paymentDisabled}
                            />
                        </div>

                        {/* Save */}
                        <div className="flex justify-end">
                            <Button type="button" onClick={handleSavePaymentMethod} disabled={paymentDisabled}>
                                {savingPayment ? "Saving..." : "Save"}
                            </Button>
                        </div>
                    </div>
                );

            case "products-team":
                return (
                    <div className="space-y-4">
                        <h3 className="text-lg font-semibold">You’re all set. Create your first product to start selling.</h3>
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
        <Dialog open={open} onOpenChange={setOpen}>
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

                {/* ABOVE the progress bar: inputs + Save */}
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
