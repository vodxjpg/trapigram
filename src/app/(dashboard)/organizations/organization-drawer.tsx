// /home/zodx/Desktop/trapigram/src/app/(dashboard)/organizations/organization-drawer.tsx
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
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
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

export function OrganizationDrawer({ open, onClose, organization }: OrganizationDrawerProps) {
  const isMobile = useIsMobile();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [slugChecking, setSlugChecking] = useState(false);
  const [slugExists, setSlugExists] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [fetchedOrg, setFetchedOrg] = useState<Organization | null>(null);
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const [verificationPhrase, setVerificationPhrase] = useState("");
  const [pendingValues, setPendingValues] = useState<FormValues | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationError, setVerificationError] = useState<string | null>(null); // New state for error message

  const formSchema = z.object({
    name: z.string().min(1, "Name is required"),
    slug: z
      .string()
      .min(1, "Slug is required")
      .regex(/^[a-z0-9-]+$/, {
        message: "Slug can only contain lowercase letters, numbers, and hyphens",
      }),
    countries: z.array(z.string().length(2)).min(1, "At least one country is required"),
    secretPhrase: organization ? z.string().optional() : z.string().min(1, "Secret phrase is required"),
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

  useEffect(() => {
    const fetchOrganization = async () => {
      if (organization?.id && open) {
        try {
          const response = await fetch(`/api/internal/organization/${organization.id}`, {
            headers: {
              "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "",
            },
          });
          if (!response.ok) throw new Error("Failed to fetch organization");
          const { organization: fetchedData } = await response.json();
          setFetchedOrg(fetchedData);

          const countries = fetchedData.countries
            ? JSON.parse(fetchedData.countries)
            : fetchedData.metadata?.countries || [];
          form.reset({
            name: fetchedData.name,
            slug: fetchedData.slug,
            countries,
            secretPhrase: "",
          });
          setSlugTouched(true);
        } catch (error) {
          console.error("Error fetching organization:", error);
          toast.error("Failed to load organization details");
        }
      } else if (!organization && open) {
        setFetchedOrg(null);
        form.reset({
          name: "",
          slug: "",
          countries: [],
          secretPhrase: "",
        });
        setSlugTouched(false);
      }
    };

    fetchOrganization();
  }, [organization, open, form]);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
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
    if (!slug || (fetchedOrg && fetchedOrg.slug === slug)) return;
    setSlugChecking(true);
    try {
      const response = await fetch(`/api/auth/organization/check-org-slug?slug=${slug}`, {
        headers: {
          "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "",
        },
      });
      if (!response.ok) throw new Error("Failed to check slug");
      const data = await response.json();
      setSlugExists(!data.available);
    } catch (error) {
      console.error("Error checking slug:", error);
      toast.error("Error checking slug availability");
    } finally {
      setSlugChecking(false);
    }
  };

  const handleSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSlugTouched(true);
    const slug = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "");
    form.setValue("slug", slug);
    checkSlugExists(slug);
  };

  const filteredCountries = allCountries.filter(
    (c) =>
      c.name.toLowerCase().includes(countrySearch.toLowerCase()) ||
      c.code.toLowerCase().includes(countrySearch.toLowerCase())
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
    form.setValue("countries", current.filter((c) => c !== code));
  };

  const generateSecurePhrase = () => {
    const rand = crypto.getRandomValues(new Uint8Array(16));
    const phrase = btoa(String.fromCharCode(...rand));
    form.setValue("secretPhrase", phrase);
  };

  const onSubmit = async (values: FormValues) => {
    if (slugExists) {
      form.setError("slug", {
        type: "manual",
        message: "This slug already exists. Please choose another one.",
      });
      return;
    }
    if (organization) {
      setPendingValues(values);
      setShowVerificationModal(true);
    } else {
      await submitOrganization(values);
    }
  };

  const submitOrganization = async (values: FormValues) => {
    setIsSubmitting(true);
    try {
      const countriesArray = values.countries;
      const metadata = { countries: countriesArray };

      if (organization) {
        await authClient.organization.update({
          data: {
            name: values.name,
            slug: values.slug,
            metadata,
          },
          organizationId: organization.id,
        });

        const updateCountriesResponse = await fetch(`/api/internal/organization/${organization.id}/update-countries`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "",
          },
          body: JSON.stringify({
            countries: JSON.stringify(countriesArray),
          }),
        });
        if (!updateCountriesResponse.ok) {
          throw new Error("Failed to update countries");
        }

        if (values.secretPhrase) {
          const response = await fetch(`/api/internal/secret-phrase`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "",
            },
            body: JSON.stringify({
              organizationId: organization.id,
              secretPhrase: values.secretPhrase,
            }),
          });
          if (!response.ok) throw new Error("Failed to update secret phrase");
        }
        toast.success("Organization updated successfully");
      } else {
        console.log("Submitting values:", values);
        if (!values.secretPhrase || values.secretPhrase.trim() === "") {
          throw new Error("Secret phrase is required and cannot be empty");
        }
        const createResponse = await authClient.organization.create({
          name: values.name,
          slug: values.slug,
          metadata,
          countries: JSON.stringify(countriesArray),
        });
        const newOrgId = createResponse.data.id;
        console.log("Created organization ID:", newOrgId);
        const secretPhrasePayload = {
          organizationId: newOrgId,
          secretPhrase: values.secretPhrase,
        };
        console.log("Secret phrase payload:", secretPhrasePayload);
        const response = await fetch(`/api/internal/secret-phrase`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "",
          },
          body: JSON.stringify(secretPhrasePayload),
        });
        if (!response.ok) {
          const errorData = await response.json();
          console.error("Secret phrase error:", errorData);
          throw new Error("Failed to set secret phrase: " + JSON.stringify(errorData));
        }
        toast.success("Organization created successfully");
      }
      onClose(true);
    } catch (error) {
      console.error("Error saving organization:", error);
      toast.error("Failed to save organization: " + (error as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerificationSubmit = async () => {
    if (!organization?.id || !verificationPhrase || !pendingValues) {
      toast.error("Missing data for verification");
      setVerificationError("Missing required data");
      return;
    }
    setIsVerifying(true);
    setVerificationError(null); // Clear previous error
    try {
      const response = await fetch("/api/internal/organization/verify-secret", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "",
        },
        body: JSON.stringify({
          organizationId: organization.id,
          secretPhrase: verificationPhrase,
        }),
      });
      if (!response.ok) {
        throw new Error("Verification request failed");
      }
      const { verified } = await response.json();
      if (verified) {
        toast.success("Secret phrase verified successfully");
        await submitOrganization(pendingValues);
        setShowVerificationModal(false);
        setVerificationPhrase("");
        setPendingValues(null);
      } else {
        setVerificationError("Invalid secret phrase");
        toast.error("Invalid secret phrase");
      }
    } catch (error) {
      console.error("Error verifying secret phrase:", error);
      setVerificationError("Failed.ConcurrentModificationException to verify secret phrase");
      toast.error("Failed to verify secret phrase");
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <>
      <Drawer open={open} onOpenChange={(open) => !open && onClose()} direction={isMobile ? "bottom" : "right"}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{organization ? "Edit Organization" : "Add Organization"}</DrawerTitle>
            <DrawerDescription>
              {organization ? "Update your organization details." : "Create a new organization for your workspace."}
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-4 overflow-y-auto">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 pb-6">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input {...field} onChange={handleNameChange} placeholder="Organization name" />
                      </FormControl>
                      <FormDescription>The display name for this organization.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="slug"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Slug</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input {...field} onChange={handleSlugChange} placeholder="organization-slug" />
                          {slugChecking && (
                            <div className="absolute right-3 top-3">
                              <Loader2 className="h-4 w-4 animate-spin" />
                            </div>
                          )}
                        </div>
                      </FormControl>
                      <FormDescription>
                        The URL-friendly identifier for this organization.
                        {slugExists && <span className="text-destructive ml-1">This slug already exists.</span>}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
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
                          onChange={(e) => setCountrySearch(e.target.value)}
                        />
                        {countrySearch && filteredCountries.length > 0 && (
                          <div className="border mt-1 p-2 max-h-36 overflow-y-auto bg-white">
                            {filteredCountries.map((country) => (
                              <div
                                key={country.code}
                                className="flex items-center gap-2 p-1 hover:bg-gray-100 cursor-pointer"
                                onClick={() => addCountry(country.code)}
                              >
                                <ReactCountryFlag countryCode={country.code} svg className="inline-block mr-2" />
                                <span>
                                  {country.name} ({country.code})
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {form.watch("countries").map((code: string) => {
                          const country = allCountries.find((c) => c.code === code);
                          if (!country) return null;
                          return (
                            <div
                              key={code}
                              className="border border-gray-300 px-2 py-1 rounded-full flex items-center"
                            >
                              <ReactCountryFlag countryCode={country.code} svg className="inline-block mr-1" />
                              <span className="mr-2 text-sm">
                                {country.name} ({country.code})
                              </span>
                              <button
                                type="button"
                                onClick={() => removeCountry(code)}
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
                    {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {organization ? "Update Organization" : "Create Organization"}
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
      <Dialog open={showVerificationModal} onOpenChange={setShowVerificationModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Verify Secret Phrase</DialogTitle>
            <DialogDescription>
              Please enter the previous secret phrase to proceed with the update.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-2">
            <Input
              type="password"
              placeholder="Enter previous secret phrase"
              value={verificationPhrase}
              onChange={(e) => setVerificationPhrase(e.target.value)}
            />
            {verificationError && (
              <p className="text-sm text-destructive">{verificationError}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowVerificationModal(false);
                setVerificationPhrase("");
                setVerificationError(null); // Clear error on cancel
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleVerificationSubmit} disabled={!verificationPhrase || isVerifying}>
              {isVerifying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Verify and Update
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}