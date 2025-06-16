"use client"

import { useState, useEffect } from "react"
import { useForm } from "react-hook-form"
import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"

import countriesLib from "i18n-iso-countries"
import enLocale from "i18n-iso-countries/langs/en.json"
import { getCountries } from "libphonenumber-js"
import ReactCountryFlag from "react-country-flag"
import { authClient } from "@/lib/auth-client"
import {
  IconBrandTelegram,
  IconBrandWhatsapp,
  IconMessageCircle
} from "@tabler/icons-react"

countriesLib.registerLocale(enLocale)
const allCountries = getCountries().map((code) => ({
  code,
  name: countriesLib.getName(code, "en") || code,
}))

interface Step1Form {
  orgName: string
  orgSlug: string
  countries: string[]
}
interface Step2Form {
  warehouseName: string
  countries: string[]
}
interface Step3Form {
  apiKey: string
  platform: string
}
interface Step4Form {
  supportEmail: string
}
interface Step5Form {
  secretPhrase: string
}

export default function OnboardingPage() {
  const [step, setStep] = useState<number | null>(null)
  const [orgId, setOrgId] = useState<string | null>(null)
  const [tenantId, setTenantId] = useState<string | null>(null) // Added tenantId state
  const totalSteps = 5

  const step1Form = useForm<Step1Form>({
    defaultValues: { orgName: "", orgSlug: "", countries: [] },
  })
  const step2Form = useForm<Step2Form>({ defaultValues: { warehouseName: "", countries: [] } })
  const step3Form = useForm<Step3Form>({ defaultValues: { apiKey: "", platform: "telegram" }})
  const step4Form = useForm<Step4Form>({ defaultValues: { supportEmail: "" } })
  const step5Form = useForm<Step5Form>({ defaultValues: { secretPhrase: "" } })
  
  const [showSecret, setShowSecret] = useState<boolean>(false)
  const ENC_KEY = process.env.NEXT_PUBLIC_ENCRYPTION_KEY || "DEFAULT_ENC_KEY"
  const ENC_IV  = process.env.NEXT_PUBLIC_ENCRYPTION_IV || "DEFAULT_ENC_IV"

  function encryptSecret(plainText: string): string {
    const saltPrefix = `${ENC_KEY}::${ENC_IV}`
    return btoa(`${saltPrefix}::${plainText}`)
  }

  function generateSecurePhrase() {
    const rand = crypto.getRandomValues(new Uint8Array(16))
    return btoa(String.fromCharCode(...rand))
  }

  const [useGlobalSwitch, setUseGlobalSwitch] = useState<boolean>(true)
  const [countryEmails, setCountryEmails] = useState<Record<string, string>>({})

  // Fetch current step and tenantId on page load
  useEffect(() => {
    async function fetchOnboardingStatusAndTenant() {
      try {
        // Fetch onboarding status
        const statusResp = await fetch("/api/internal/onboarding/status", {
          method: "GET",
          headers: {
            "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET as string,
          },
        });
        if (!statusResp.ok) {
          throw new Error("Failed to fetch onboarding status");
        }
        const { currentStep } = await statusResp.json();
        if (currentStep > 5 || currentStep === -1) { // Check for completion
          window.location.href = "/select-organization";
        } else {
          setStep(currentStep || 1); // Only set step if in progress
        }

        // Fetch tenantId
        const tenantResp = await fetch("/api/internal/tenant", {
          method: "GET", // Add a GET endpoint or use existing session data
          headers: {
            "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET as string,
          },
        });
        if (!tenantResp.ok) {
          throw new Error("Failed to fetch tenant");
        }
        const tenantData = await tenantResp.json();
        setTenantId(tenantData.tenant.id);
      } catch (err) {
        console.error("Failed to fetch onboarding status or tenant:", err);
        toast.error("Failed to load onboarding status or tenant");
        setStep(1); // Fallback
      }
    }
    fetchOnboardingStatusAndTenant();
  }, []);

  const updateStep = async (newStep: number) => {
    try {
      const response = await fetch("/api/internal/onboarding", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET as string,
        },
        body: JSON.stringify({ onboardingCompleted: newStep }),
      })
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || "Failed to update step")
      }
      setStep(newStep)
      toast.success(`Moved to step ${newStep}`)
    } catch (err) {
      toast.error("Failed to update onboarding step")
      console.error(err)
    }
  }

  const onStep1Submit = async (data: Step1Form) => {
    try {
      const { data: org, error } = await authClient.organization.create({
        name: data.orgName,
        slug: data.orgSlug,
        metadata: {
          countries: data.countries,
        },
      })
      if (error) {
        toast.error(`Failed to create organization: ${error.message}`)
        return
      }
      setOrgId(org.id || null)
      await updateStep(2)
      toast.success("Organization created successfully!")
    } catch (err) {
      console.error("Failed to create organization:", err)
      toast.error("Failed to create organization")
    }
  }

  const onStep2Submit = async (data: Step2Form) => {
    try {
      if (!orgId) {
        toast.error("No organization ID found!");
        return;
      }
      if (!tenantId) {
        toast.error("No tenant ID found!");
        return;
      }
      const resp = await fetch("/api/internal/warehouses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET as string,
        },
        body: JSON.stringify({
          organizationIds: [orgId], // Send as array, can expand later
          warehouseName: data.warehouseName,
          countries: data.countries,
          tenantId: tenantId, // Pass tenantId to the API
        }),
      });
      if (!resp.ok) {
        const e = await resp.json();
        throw new Error(e.error || "Failed to create warehouse");
      }
      await updateStep(3);
      toast.success("Warehouse created successfully!");
    } catch (err) {
      console.error("Create warehouse error:", err);
      toast.error("Failed to create warehouse");
    }
  }

  const onStep3Submit = async (data: Step3Form) => {
    try {
      if (!orgId) {
        toast.error("No organization ID found!")
        return
      }
      const resp = await fetch("/api/internal/platform-keys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET as string,
        },
        body: JSON.stringify({
          organizationId: orgId,
          platform: data.platform,
          apiKey: data.apiKey
        })
      })
      if (!resp.ok) {
        const e = await resp.json()
        throw new Error(e.error || "Failed to save API key")
      }
      await updateStep(4)
      toast.success("API key step completed!")
    } catch (err) {
      console.error(err)
      toast.error("Failed to complete step3")
    }
  }

  const onStep4Submit = async (data: Step4Form) => {
    try {
      if (!orgId) {
        toast.error("No organization ID found!")
        return
      }
      const orgCountries = step1Form.getValues("countries") || []
  
      if (useGlobalSwitch) {
        const resp = await fetch("/api/internal/support-emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET as string,
          },
          body: JSON.stringify({
            organizationId: orgId,
            email: data.supportEmail,
            country: null, // Global email
            isGlobal: true, // Explicitly set isGlobal
          }),
        });
        if (!resp.ok) {
          const e = await resp.json();
          throw new Error(e.error || "Failed to save support email");
        }
        toast.success(`Using SINGLE (global) email: ${data.supportEmail}`);
      } else {
        for (const c of orgCountries) {
          const cEmail = countryEmails[c];
          if (!cEmail) continue;
          const resp = await fetch("/api/internal/support-emails", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET as string,
            },
            body: JSON.stringify({
              organizationId: orgId,
              email: cEmail,
              country: c,
              isGlobal: false, // Explicitly set isGlobal
            }),
          });
          if (!resp.ok) {
            const e = await resp.json();
            throw new Error(e.error || `Failed to save email for ${c}`);
          }
          toast.success(`Email for ${c}: ${cEmail}`);
        }
      }
  
      await updateStep(5)
      toast.success("Support email step completed!")
    } catch (err) {
      console.error(err)
      toast.error("Failed to complete support email step")
    }
  }

  async function onStep5PlainSubmit(data: Step5Form) {
    try {
      if (!orgId) {
        toast.error("No organization ID found!");
        return;
      }
      const resp = await fetch("/api/internal/secret-phrase", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET as string,
        },
        body: JSON.stringify({
          organizationId: orgId,
          secretPhrase: data.secretPhrase,
        }),
      });
      if (!resp.ok) {
        const e = await resp.json();
        throw new Error(e.error || "Failed to store secret phrase");
      }
  
      // Set onboardingCompleted to -1 to mark completion
      await updateStep(-1);
      toast.success("Onboarding completed with server-side encryption!");
      window.location.href = "/select-organization";
    } catch (err) {
      console.error("Failed step5 encryption:", err);
      toast.error("Failed to store secret phrase");
    }
  }

  const [slugCheckTimer, setSlugCheckTimer] = useState<NodeJS.Timeout | null>(null)
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null)
  const watchOrgName = step1Form.watch("orgName")
  const watchOrgSlug = step1Form.watch("orgSlug")

  useEffect(() => {
    const autoSlug = watchOrgName.toLowerCase().replace(/\s+/g, "-")
    step1Form.setValue("orgSlug", autoSlug)
    if (slugCheckTimer) clearTimeout(slugCheckTimer)

    const t = setTimeout(() => {
      checkSlugDirect(autoSlug)
    }, 500)
    setSlugCheckTimer(t)
  }, [watchOrgName])

  useEffect(() => {
    if (!watchOrgSlug) {
      setSlugAvailable(null)
      return
    }
    if (slugCheckTimer) clearTimeout(slugCheckTimer)
    const t = setTimeout(() => {
      checkSlugDirect(watchOrgSlug)
    }, 500)
    setSlugCheckTimer(t)
  }, [watchOrgSlug])

  async function checkSlugDirect(slug: string) {
    if (!slug) {
      setSlugAvailable(null)
      return
    }
    try {
      const resp = await fetch(`/api/internal/organization/check-org-slug?slug=${slug}`, {
        method: "GET",
        headers: {
          "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET as string,
        },
      })
      if (!resp.ok) {
        if (resp.status === 404) {
          setSlugAvailable(true)
          return
        }
        throw new Error("Non-200 status from check org slug")
      }
      const data = await resp.json()
      if (data.available === true) {
        setSlugAvailable(true)
      } else {
        setSlugAvailable(false)
      }
    } catch (err) {
      console.error("Slug check error:", err)
      setSlugAvailable(false)
    }
  }

  const [countrySearch, setCountrySearch] = useState("")
  const filteredCountries = allCountries.filter(
    (c) =>
      c.name.toLowerCase().includes(countrySearch.toLowerCase()) ||
      c.code.toLowerCase().includes(countrySearch.toLowerCase())
  )
  function addCountryToForm(code: string) {
    const current = step1Form.getValues("countries")
    if (!current.includes(code)) {
      step1Form.setValue("countries", [...current, code])
    }
    setCountrySearch("")
  }
  function removeCountryFromForm(code: string) {
    const current = step1Form.getValues("countries")
    step1Form.setValue("countries", current.filter((c) => c !== code))
  }

  if (step === null) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="w-full max-w-md bg-white p-6">
          <div className="mb-6 text-center m-auto">
            <h1 className="text-lg font-semibold">Loading...</h1>
            <p className="text-sm text-muted-foreground">Checking your onboarding status</p>
          </div>
        </div>
      </div>
    );
  }
  // Error state check
  if (step < 1 || step > totalSteps) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="w-full max-w-md bg-white p-6">
          <div className="mb-6 m-auto text-center">
            <h1 className="text-lg font-semibold">Loading...</h1>
            <p className="text-sm text-muted-foreground">Checking your onboarding status</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 pt-8 bg-background">
      <div className="fixed top-0 left-0 w-full z-50">
        <div className="w-full bg-muted h-2">
          <div
            className="bg-primary h-full transition-all duration-300 ease-in-out"
            style={{ width: `${((step - 1) / (totalSteps - 1)) * 100}%` }}
          />
        </div>
      </div>

      <div className="w-full max-w-md space-y-6">
        <div className="w-full bg-white">
          <div className="mb-6">
            <h1 className="text-lg font-semibold">It's time to set your account</h1>
            <p className="text-sm text-muted-foreground">
              Step {step} of {totalSteps}
            </p>
          </div>
          <div>
            {step === 1 && (
              <Form {...step1Form}>
                <form onSubmit={step1Form.handleSubmit(onStep1Submit)} className="space-y-4">
                  <FormField
                    control={step1Form.control}
                    name="orgName"
                    rules={{ required: "Organization name is required" }}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Shop name</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., My Org" {...field} />
                          
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={step1Form.control}
                    name="orgSlug"
                    rules={{ required: "Organization slug is required" }}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Slug</FormLabel>
                        <FormControl>
                          <Input placeholder="my-org" {...field} />
                        </FormControl>
                        {slugAvailable === true && (
                          <p className="text-green-500 text-sm mt-1">✓ Slug is available!</p>
                        )}
                        {slugAvailable === false && (
                          <p className="text-red-500 text-sm mt-1">Slug is taken!</p>
                        )}
                        {slugAvailable === null && (
                          <p className="text-gray-400 text-sm mt-1">
                            Please enter a slug for your shop.
                          </p>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={step1Form.control}
                    name="countries"
                    rules={{ required: "Select at least one country" }}
                    render={() => (
                      <FormItem>
                        <FormLabel>Selling Countries</FormLabel>
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
                                  onClick={() => addCountryToForm(country.code)}
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
                          <p className="text-gray-400 text-sm mt-1 text-center">Select the countries that you are planning to sell to. This can be change later on</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {step1Form.watch("countries").map((code: string) => {
                            const cObj = allCountries.find((c) => c.code === code)
                            if (!cObj) return null
                            return (
                              <div
                                key={code}
                                className="border border-gray-300 px-2 py-1 rounded-full flex items-center"
                              >
                                <ReactCountryFlag
                                  countryCode={cObj.code}
                                  svg
                                  className="inline-block mr-1"
                                />
                                <span className="mr-2 text-sm">
                                  {cObj.name} ({cObj.code})
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const arr = step1Form.getValues("countries")
                                    step1Form.setValue(
                                      "countries",
                                      arr.filter((x) => x !== code)
                                    )
                                  }}
                                  className="text-red-500 text-sm font-bold"
                                >
                                  x
                                </button>
                              </div>
                            )
                          })}
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="flex justify-between">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => setStep(step - 1)}
                      disabled={step === 1}
                    >
                      Back
                    </Button>
                    <Button type="submit" size="sm">
                      Next
                    </Button>
                  </div>
                </form>
              </Form>
            )}

            {step === 2 && (
              <Form {...step2Form}>
                <form onSubmit={step2Form.handleSubmit(onStep2Submit)} className="space-y-4">
                  <FormField
                    control={step2Form.control}
                    name="warehouseName"
                    rules={{ required: "Warehouse name is required" }}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Warehouse Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Main Warehouse" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <p className="text-gray-400 text-sm mt-1">
                    Warehouses are to control your product stock, you can add more later on.
                  </p>

                  <FormField
                    control={step2Form.control}
                    name="countries"
                    rules={{ required: "Select at least one country" }}
                    render={({ field }) => {
                      const [search, setSearch] = useState("")
                      const filtered = allCountries.filter(
                        (c) =>
                          c.name.toLowerCase().includes(search.toLowerCase()) ||
                          c.code.toLowerCase().includes(search.toLowerCase())
                      )

                      function addC(code: string) {
                        const current = step2Form.getValues("countries")
                        if (!current.includes(code)) {
                          step2Form.setValue("countries", [...current, code])
                        }
                        setSearch("")
                      }
                      function removeC(code: string) {
                        const current = step2Form.getValues("countries")
                        step2Form.setValue(
                          "countries",
                          current.filter((c) => c !== code)
                        )
                      }

                      return (
                        <FormItem>
                          <FormLabel>Warehouse Countries</FormLabel>
                          <div className="mb-2">
                            <Input
                              placeholder="Search country..."
                              value={search}
                              onChange={(e) => setSearch(e.target.value)}
                            />
                            {search && filtered.length > 0 && (
                              <div className="border mt-1 p-2 max-h-36 overflow-y-auto bg-white">
                                {filtered.map((country) => (
                                  <div
                                    key={country.code}
                                    className="flex items-center gap-2 p-1 hover:bg-gray-100 cursor-pointer"
                                    onClick={() => addC(country.code)}
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
                            {step2Form.watch("countries").map((code: string) => {
                              const co = allCountries.find((c) => c.code === code)
                              if (!co) return null
                              return (
                                <div
                                  key={code}
                                  className="border border-gray-300 px-2 py-1 rounded-full flex items-center"
                                >
                                  <ReactCountryFlag
                                    countryCode={co.code}
                                    svg
                                    className="inline-block mr-1"
                                  />
                                  <span className="mr-2 text-sm">
                                    {co.name} ({co.code})
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => removeC(code)}
                                    className="text-red-500 text-sm font-bold"
                                  >
                                    x
                                  </button>
                                </div>
                              )
                            })}
                            <p className="text-gray-400 text-sm mt-1">
                              Select to which countries your warehouse is going to serve the stock to.
                            </p>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )
                    }}
                  />

                  <div className="flex justify-between">
                    <Button type="button" size="sm" onClick={() => setStep(1)}>
                      Back
                    </Button>
                    <Button type="submit" size="sm">
                      Next
                    </Button>
                  </div>
                </form>
              </Form>
            )}

            {step === 3 && (
              <Form {...step3Form}>
                <form onSubmit={step3Form.handleSubmit(onStep3Submit)} className="space-y-4">
                  <div className="flex gap-4 items-center">
                    <button
                      type="button"
                      onClick={() => step3Form.setValue("platform", "telegram")}
                      className={`p-3 border rounded flex flex-col items-center justify-center ${
                        step3Form.watch("platform") === "telegram"
                          ? "border-blue-500"
                          : "border-gray-300"
                      }`}
                    >
                      <IconBrandTelegram />
                      <span className="text-sm">Telegram</span>
                    </button>

                    <div className="p-3 border border-gray-300 rounded opacity-50 cursor-not-allowed flex flex-col items-center justify-center">
                      <IconBrandWhatsapp />
                      <span className="text-sm">WhatsApp (coming soon)</span>
                    </div>

                    <div className="p-3 border border-gray-300 rounded opacity-50 cursor-not-allowed flex flex-col items-center justify-center">
                      <IconMessageCircle />
                      <span className="text-sm">Signal (coming soon)</span>
                    </div>
                  </div>

                  <FormField
                    control={step3Form.control}
                    name="apiKey"
                    rules={{ required: "API key is required" }}
                    render={({ field }) => {
                      const [showKey, setShowKey] = useState(false)
                      return (
                        <FormItem>
                          <FormLabel>Telegram API Key</FormLabel>
                          <div className="relative">
                            <FormControl>
                              <Input
                                type={showKey ? "text" : "password"}
                                placeholder="Enter API key"
                                {...field}
                              />
                            </FormControl>
                            <button
                              type="button"
                              onClick={() => setShowKey(!showKey)}
                              className="absolute right-2 top-2 text-sm text-gray-500"
                            >
                              {showKey ? "Hide" : "Show"}
                            </button>
                          </div>
                          <p className="text-gray-400 text-sm mt-1">
                              Please enter your bot API key, you can get this from telegram Bot Father or the relevant part to the other platforms.
                          </p>
                          <FormMessage />
                        </FormItem>
                        
                      )
                    }}
                  />

                  <div className="flex justify-between">
                    <Button type="button" size="sm" onClick={() => setStep(2)}>
                      Back
                    </Button>
                    <Button type="submit" size="sm">
                      Next
                    </Button>
                  </div>
                </form>
              </Form>
            )}

            {step === 4 && (
              <Form {...step4Form}>
                <form onSubmit={step4Form.handleSubmit(onStep4Submit)} className="space-y-4">
                  <div className="flex items-center justify-between">
                    <FormLabel className="mb-0">Use One Email for All Countries?</FormLabel>
                    <Switch
                      checked={useGlobalSwitch}
                      onCheckedChange={(val) => setUseGlobalSwitch(val)}
                    />
                  </div>

                  {useGlobalSwitch ? (
                    <FormField
                      control={step4Form.control}
                      name="supportEmail"
                      rules={{ required: "Support email is required if global is on" }}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Support Email (Global)</FormLabel>
                          <FormControl>
                            <Input placeholder="support@myorg.com" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground">
                        Add a different support email for each country:
                      </p>
                      {step1Form.watch("countries").map((code) => {
                        return (
                          <div key={code} className="flex items-center gap-2">
                            <ReactCountryFlag countryCode={code} svg />
                            <span className="w-12 text-sm">{code}</span>
                            <Input
                              placeholder={`support@${code.toLowerCase()}.com`}
                              value={countryEmails[code] || ""}
                              onChange={(e) =>
                                setCountryEmails({
                                  ...countryEmails,
                                  [code]: e.target.value
                                })
                              }
                            />
                          </div>
                        )
                      })}
                    </>
                  )}
                  <p className="text-gray-400 text-sm mt-1">
                    Enter an email where users can get back to you with tracking information questions and more.
                  </p>

                  <div className="flex justify-between">
                    <Button type="button" size="sm" onClick={() => setStep(3)}>
                      Back
                    </Button>
                    <Button type="submit" size="sm">
                      Next
                    </Button>
                  </div>
                </form>
              </Form>
            )}

            {step === 5 && (
              <Form {...step5Form}>
                <form onSubmit={step5Form.handleSubmit(onStep5PlainSubmit)} className="space-y-4">
                  <FormField
                    control={step5Form.control}
                    name="secretPhrase"
                    rules={{ required: "Secret phrase is required" }}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Secret Phrase</FormLabel>
                        <div className="relative mb-2">
                          <FormControl>
                            <Input
                              type={showSecret ? "text" : "password"}
                              placeholder="Some secret"
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
                          onClick={() => field.onChange(generateSecurePhrase())}
                        >
                          Generate Secure Phrase
                        </Button>
                        <FormMessage />
                        <p className="text-gray-400 text-sm mt-3 text-center">
                          Please enter or generate a secured secret phrase, do not forget it since this will be asked for certain actions
                        </p>
                      </FormItem>
                      
                    )}
                  />
                  <div className="flex justify-between">
                    <Button type="button" size="sm" onClick={() => setStep(4)}>
                      Back
                    </Button>
                    <Button type="submit" size="sm">
                      Finish
                    </Button>
                  </div>
                </form>
              </Form>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}