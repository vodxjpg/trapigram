"use client"

import type React from "react";
import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { authClient } from "@/lib/auth-client";

import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
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
import { useIsMobile } from "@/hooks/use-mobile";
import countriesLib from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";
import { getCountries } from "libphonenumber-js";
import ReactCountryFlag from "react-country-flag";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

countriesLib.registerLocale(enLocale);
const allCountries = getCountries().map((code) => ({
  code,
  name: countriesLib.getName(code, "en") || code,
}));

type Organization = {
  id: string;
  name: string;
  slug: string;
  logo?: string | null;
  countries?: string;
  metadata?: { countries?: string[]; tenantId?: string };
  encryptedSecret?: string;
};

type FormValues = {
  name: string;
  slug: string;
  countries: string[];
  secretPhrase?: string;
};

interface OrganizationDrawerProps {
  open: boolean;
  onClose: (refreshData?: boolean) => void;
  organization: Organization | null;
}

export function OrganizationDrawer({
  open,
  onClose,
  organization,
}: OrganizationDrawerProps) {
  const isMobile = useIsMobile();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [slugChecking, setSlugChecking] = useState(false);
  const [slugExists, setSlugExists] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [fetchedOrg, setFetchedOrg] = useState<Organization | null>(null);
  const [showVerificationModal, setShowVerificationModal] =
    useState(false);
  const [verificationPhrase, setVerificationPhrase] = useState("");
  const [pendingValues, setPendingValues] =
    useState<FormValues | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationError, setVerificationError] =
    useState<string | null>(null);

  const formSchema = z.object({
    name: z.string().min(1, "Name is required"),
    slug: z
      .string()
      .min(1, "Slug is required")
      .regex(/^[a-z0-9-]+$/, {
        message:
          "Slug can only contain lowercase letters, numbers, and hyphens",
      }),
    countries: z
      .array(z.string().length(2))
      .min(1, "At least one country is required"),
    secretPhrase: organization
      ? z.string().optional()
      : z.string().min(1, "Secret phrase is required"),
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      slug: "",
      countries: [],
      secretPhrase: "",
    },
  });

  // ─── Fetch existing org when editing ────────────────────────
  useEffect(() => {
    if (!organization?.id || !open) return;
    (async () => {
      try {
        const resp = await fetch(
          `/api/organizations/${organization.id}?organizationId=${organization.id}`,
          { credentials: "include" }
        );
        if (!resp.ok) throw new Error(resp.statusText);
        const { organization: data } = await resp.json();
        setFetchedOrg(data);

        const countries = data.countries
          ? JSON.parse(data.countries)
          : data.metadata?.countries || [];
        form.reset({
          name: data.name,
          slug: data.slug,
          countries,
          secretPhrase: "",
        });
        setSlugTouched(true);
      } catch (err) {
        console.error("Error fetching organization:", err);
        toast.error("Failed to load organization details");
      }
    })();
  }, [organization, open, form]);

  // ─── Handlers for form fields ───────────────────────────────
  const handleNameChange = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const name = e.target.value;
    form.setValue("name", name);
    if (!slugTouched) {
      const generatedSlug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      form.setValue("slug", generatedSlug);
      checkSlugExists(generatedSlug);
    }
  };

  const checkSlugExists = async (slug: string) => {
    if (!slug || (fetchedOrg && fetchedOrg.slug === slug))
      return;
    setSlugChecking(true);
    try {
      const res = await fetch(
        `/api/auth/organization/check-org-slug?slug=${slug}`
      );
      if (!res.ok) throw new Error("Failed to check slug");
      const { available } = await res.json();
      setSlugExists(!available);
    } catch (err) {
      console.error("Error checking slug:", err);
      toast.error("Error checking slug availability");
    } finally {
      setSlugChecking(false);
    }
  };

  const handleSlugChange = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    setSlugTouched(true);
    const slug = e.target.value
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "");
    form.setValue("slug", slug);
    checkSlugExists(slug);
  };

  const filteredCountries = allCountries.filter(
    (c) =>
      c.name
        .toLowerCase()
        .includes(countrySearch.toLowerCase()) ||
      c.code
        .toLowerCase()
        .includes(countrySearch.toLowerCase())
  );

  const addCountry = (code: string) => {
    const current = form.getValues("countries");
    if (!current.includes(code)) {
      form.setValue("countries", [...current, code]);
    }
    setCountrySearch("");
  };

  const removeCountry = (code: string) => {
    const current = form.getValues("countries");
    form.setValue(
      "countries",
      current.filter((c) => c !== code)
    );
  };

  const generateSecurePhrase = () => {
    const rand = crypto.getRandomValues(new Uint8Array(16));
    const phrase = btoa(
      String.fromCharCode(...rand)
    );
    form.setValue("secretPhrase", phrase);
  };

  // ─── Form submission ────────────────────────────────────────
  const onSubmit = async (values: FormValues) => {
    if (slugExists) {
      form.setError("slug", {
        type: "manual",
        message: "This slug already exists.",
      });
      return;
    }

    if (organization) {
      setPendingValues(values);
      setShowVerificationModal(true);
    } else {
      await handleCreate(values);
    }
  };

  // ─── Create new org via authClient, then optional secret patch ─
  const handleCreate = async (values: FormValues) => {
    setIsSubmitting(true);
    try {
      // 1) create via SDK
      const createRes = await authClient.organization.create({
        name: values.name,
        slug: values.slug,
        metadata: { countries: values.countries },
        countries: JSON.stringify(values.countries),
      });
      const newId = createRes.data.id;

      // 2) if secretPhrase provided, PATCH it in
      if (values.secretPhrase) {
        await fetch(
          `/api/organizations/${newId}?organizationId=${newId}`,
          {
            method: "PATCH",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              secretPhrase: values.secretPhrase,
            }),
          }
        );
      }

      toast.success("Organization created successfully");
      onClose(true);
    } catch (err: any) {
      console.error("Create org failed:", err);
      toast.error("Failed to create organization: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // ─── Update existing org ────────────────────────────────────
  const handleUpdate = async (values: FormValues) => {
    setIsSubmitting(true);
    try {
      const payload: any = {
        name: values.name,
        slug: values.slug,
        countries: values.countries,
      };
      if (values.secretPhrase) payload.secretPhrase = values.secretPhrase;

      await fetch(
        `/api/organizations/${organization!.id}?organizationId=${organization!.id}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      toast.success("Organization updated successfully");
      onClose(true);
    } catch (err: any) {
      console.error("Update failed:", err);
      toast.error("Failed to update organization: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // ─── Verification before updating ──────────────────────────
  const handleVerificationSubmit = async () => {
    if (
      !verificationPhrase ||
      !pendingValues ||
      !organization
    ) {
      toast.error("Missing data for verification");
      setVerificationError("Missing required data");
      return;
    }
    setIsVerifying(true);
    setVerificationError(null);

    try {
      const resp = await fetch(
        `/api/organizations/verify-secret?organizationId=${organization.id}`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId: organization.id,
            secretPhrase: verificationPhrase,
          }),
        }
      );
      const { verified } = await resp.json();
      if (verified) {
        toast.success(
          "Secret phrase verified successfully"
        );
        await handleUpdate(pendingValues!);
        setShowVerificationModal(false);
        setPendingValues(null);
        setVerificationPhrase("");
      } else {
        setVerificationError("Invalid secret phrase");
        toast.error("Invalid secret phrase");
      }
    } catch (err: any) {
      console.error("Verify failed:", err);
      setVerificationError("Failed to verify secret phrase");
      toast.error("Failed to verify secret phrase");
    } finally {
      setIsVerifying(false);
    }
  };
  return (
    <>
      <Drawer
        open={open}
        onOpenChange={(o) => !o && onClose()}
        direction={isMobile ? "bottom" : "right"}
      >
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>
              {organization ? "Edit Organization" : "Add Organization"}
            </DrawerTitle>
            <DrawerDescription>
              {organization
                ? "Update your organization details."
                : "Create a new organization for your workspace."}
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-4 overflow-y-auto">
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-6 pb-6"
              >
                {/* Name */}
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          onChange={handleNameChange}
                          placeholder="Organization name"
                        />
                      </FormControl>
                      <FormDescription>
                        The display name for this organization.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {/* Slug */}
                <FormField
                  control={form.control}
                  name="slug"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Slug</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            {...field}
                            onChange={handleSlugChange}
                            placeholder="organization-slug"
                          />
                          {slugChecking && (
                            <div className="absolute right-3 top-3">
                              <Loader2 className="h-4 w-4 animate-spin" />
                            </div>
                          )}
                        </div>
                      </FormControl>
                      <FormDescription>
                        The URL-friendly identifier for this organization.
                        {slugExists && (
                          <span className="text-destructive ml-1">
                            This slug already exists.
                          </span>
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {/* Countries */}
                <FormField
                  control={form.control}
                  name="countries"
                  render={() => (
                    <FormItem>
                      <FormLabel>Countries</FormLabel>
                      <div className="mb-2">
                        <Input
                          placeholder="Search country..."
                          value={countrySearch}
                          onChange={(e) =>
                            setCountrySearch(e.target.value)
                          }
                        />
                        {countrySearch &&
                          filteredCountries.length > 0 && (
                            <div className="border mt-1 p-2 max-h-36 overflow-y-auto bg-white">
                              {filteredCountries.map((country) => (
                                <div
                                  key={country.code}
                                  className="flex items-center gap-2 p-1 hover:bg-gray-100 cursor-pointer"
                                  onClick={() =>
                                    addCountry(country.code)
                                  }
                                >
                                  <ReactCountryFlag
                                    countryCode={country.code}
                                    svg
                                    className="inline-block mr-2"
                                  />
                                  <span>
                                    {country.name} ({country.code})
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {form
                          .watch("countries")
                          .map((code: string) => {
                            const country = allCountries.find(
                              (c) => c.code === code
                            );
                            if (!country) return null;
                            return (
                              <div
                                key={code}
                                className="border border-gray-300 px-2 py-1 rounded-full flex items-center"
                              >
                                <ReactCountryFlag
                                  countryCode={country.code}
                                    svg
                                  className="inline-block mr-1"
                                />
                                <span className="mr-2 text-sm">
                                  {country.name} ({country.code})
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    removeCountry(code)
                                  }
                                  className="text-red-500 text-sm font-bold"
                                >
                                  x
                                </button>
                              </div>
                            );
                          })}
                      </div>
                      <FormDescription>
                        Select the countries this organization operates in.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {/* Secret Phrase */}
                <FormField
                  control={form.control}
                  name="secretPhrase"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Secret Phrase</FormLabel>
                      <div className="relative mb-2">
                        <FormControl>
                          <Input
                            type={showSecret ? "text" : "password"}
                            placeholder="Enter secret phrase"
                            {...field}
                          />
                        </FormControl>
                        <button
                          type="button"
                          onClick={() => setShowSecret(!showSecret)}
                          className="absolute right-2 top-2 text-sm text-gray-500"
                        >
                          {showSecret ? "Hide" : "Show"}
                        </button>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="flex m-auto"
                        onClick={generateSecurePhrase}
                      >
                        Generate Secure Phrase
                      </Button>
                      <FormDescription>
                        {organization
                          ? "Enter a new secret phrase to update it, or leave blank to keep the existing one."
                          : "Enter a secret phrase or generate one."}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DrawerFooter className="px-0">
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    {organization
                      ? "Update Organization"
                      : "Create Organization"}
                  </Button>
                  <DrawerClose asChild>
                    <Button variant="outline">Cancel</Button>
                  </DrawerClose>
                </DrawerFooter>
              </form>
            </Form>
          </div>
        </DrawerContent>
      </Drawer>

      <Dialog
        open={showVerificationModal}
        onOpenChange={setShowVerificationModal}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Verify Secret Phrase</DialogTitle>
            <DialogDescription>
              Please enter the previous secret phrase to proceed with the
              update.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-2">
            <Input
              type="password"
              placeholder="Enter previous secret phrase"
              value={verificationPhrase}
              onChange={(e) =>
                setVerificationPhrase(e.target.value)
              }
            />
            {verificationError && (
              <p className="text-sm text-destructive">
                {verificationError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowVerificationModal(false);
                setVerificationPhrase("");
                setVerificationError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleVerificationSubmit}
              disabled={!verificationPhrase || isVerifying}
            >
              {isVerifying && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Verify and Update
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
