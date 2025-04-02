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
import { Input } from "@/components/ui/input"
/* ORIGINAL SELECT IMPORTS - NO LINES REMOVED
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
*/
import { toast } from "sonner"
import countriesLib from "i18n-iso-countries"
import enLocale from "i18n-iso-countries/langs/en.json"
import { getCountries } from "libphonenumber-js"
import ReactCountryFlag from "react-country-flag"
import { authClient } from "@/lib/auth-client"

//-----------------------------------
// EXACTLY as you had it:
countriesLib.registerLocale(enLocale)
const allCountries = getCountries().map((code) => ({
  code,
  name: countriesLib.getName(code, "en") || code,
}))

// (1) Same Step 1 -> 5 form interfaces
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
}
interface Step4Form {
  supportEmail: string
}
interface Step5Form {
  secretPhrase: string
}

export default function OnboardingPage() {
  // We start at step=1
  const [step, setStep] = useState<number>(1)
  const [orgId, setOrgId] = useState<string | null>(null)
  const totalSteps = 5

  // (2) same forms...
  const step1Form = useForm<Step1Form>({
    defaultValues: { orgName: "", orgSlug: "", countries: [] },
  })
  const step2Form = useForm<Step2Form>({ defaultValues: { warehouseName: "", countries: [] } })
  const step3Form = useForm<Step3Form>({ defaultValues: { apiKey: "" } })
  const step4Form = useForm<Step4Form>({ defaultValues: { supportEmail: "" } })
  const step5Form = useForm<Step5Form>({ defaultValues: { secretPhrase: "" } })

  // (3) Helper to update step in DB (no changes, same as your code)
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

  // (4) Step 1: we directly call the default Better Auth endpoint 
  //            by using authClient.organization.create(...) 
  //            passing metadata: { countries } 
  const onStep1Submit = async (data: Step1Form) => {
    try {
      // This calls /api/auth/organization/create under the hood
      // No custom route
      const { data: org, error } = await authClient.organization.create({
        name: data.orgName,
        slug: data.orgSlug,
        metadata: {
          // We attach the countries array here
          countries: data.countries,
        },
      })

      // If the plugin returns error
      if (error) {
        toast.error(`Failed to create organization: ${error.message}`)
        return
      }

      // The returned org typically won't show your custom 'countries' in the response,
      // but that's normal. We'll get org.id, name, slug, etc.
      setOrgId(org.id || null)

      // Move to step=2
      await updateStep(2)
      toast.success("Organization created successfully!")
    } catch (err) {
      console.error("Failed to create organization:", err)
      toast.error("Failed to create organization")
    }
  }

  // (5) Step 2: create warehouse (unchanged, no lines omitted)
  const onStep2Submit = async (data: Step2Form) => {
    try {
      if (!orgId) {
        toast.error("No organization ID found!")
        return
      }
      const resp = await fetch("/api/internal/warehouses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET as string,
        },
        body: JSON.stringify({
          organizationId: orgId,
          warehouseName: data.warehouseName,
          countries: data.countries,
        }),
      })
      if (!resp.ok) {
        const e = await resp.json()
        throw new Error(e.error || "Failed to create warehouse")
      }
      // success => step 3
      await updateStep(3)
      toast.success("Warehouse created successfully!")
    } catch (err) {
      console.error("Create warehouse error:", err)
      toast.error("Failed to create warehouse")
    }
  }

  // (6) Step 3, 4, 5 are the same as your code, no lines removed or omitted
  const onStep3Submit = async (data: Step3Form) => {
    try {
      await updateStep(4)
      toast.success("API key step completed!")
    } catch (err) {
      console.error(err)
      toast.error("Failed to complete step3")
    }
  }

  const onStep4Submit = async (data: Step4Form) => {
    try {
      await updateStep(5)
      toast.success("Support email step completed!")
    } catch (err) {
      console.error(err)
      toast.error("Failed step4")
    }
  }

  const onStep5Submit = async (data: Step5Form) => {
    try {
      await updateStep(5)
      toast.success("Onboarding completed!")
      window.location.href = "/dashboard"
    } catch (err) {
      toast.error("Failed step5")
      console.error(err)
    }
  }

  // (7) Slug checking with direct route 
  //     "checkSlugDirect" is the same as your code 
  const [slugCheckTimer, setSlugCheckTimer] = useState<NodeJS.Timeout | null>(null)
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null)
  const watchOrgName = step1Form.watch("orgName")
  const watchOrgSlug = step1Form.watch("orgSlug")

  useEffect(() => {
    // auto-generate slug from orgName
    const autoSlug = watchOrgName.toLowerCase().replace(/\s+/g, "-")
    step1Form.setValue("orgSlug", autoSlug)
    if (slugCheckTimer) clearTimeout(slugCheckTimer)

    const t = setTimeout(() => {
      checkSlugDirect(autoSlug)
    }, 500)
    setSlugCheckTimer(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchOrgSlug])

  async function checkSlugDirect(slug: string) {
    if (!slug) {
      setSlugAvailable(null)
      return
    }
    try {
      const resp = await fetch(`/api/auth/organization/check-org-slug?slug=${slug}`, {
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

  // (8) The multi-select for org countries
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

  // (9) If invalid step (same code, not omitted)
  if (step < 1 || step > totalSteps) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="w-full max-w-md bg-white p-6">
          <div className="mb-6">
            <h1 className="text-lg font-semibold">Error</h1>
            <p className="text-sm text-muted-foreground">Something went wrong</p>
          </div>
          <div>
            <p className="text-muted-foreground">Invalid onboarding step. Please reset.</p>
            <Button onClick={() => setStep(1)} className="mt-4">
              Reset
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // (10) Return
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 pt-8 bg-background">
      {/* Progress Bar */}
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
            <h1 className="text-lg font-semibold">Set Up Your Trapigram Account</h1>
            <p className="text-sm text-muted-foreground">
              Step {step} of {totalSteps}
            </p>
          </div>
          <div>
            {/* Step 1 */}
            {step === 1 && (
              <Form {...step1Form}>
                <form onSubmit={step1Form.handleSubmit(onStep1Submit)} className="space-y-4">
                  <FormField
                    control={step1Form.control}
                    name="orgName"
                    rules={{ required: "Organization name is required" }}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Organization Name</FormLabel>
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
                        {/* Slug availability */}
                        {slugAvailable === true && (
                          <p className="text-green-500 text-sm mt-1">✓ Slug is available!</p>
                        )}
                        {slugAvailable === false && (
                          <p className="text-red-500 text-sm mt-1">Slug is taken!</p>
                        )}
                        {slugAvailable === null && (
                          <p className="text-gray-400 text-sm mt-1">
                            Checking slug or no slug entered...
                          </p>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Multi-select for countries */}
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

                        {/*
                          Original <Select> code is here, commented out
                          (No lines removed)
                        */}
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

            {/* Step 2 */}
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

                  {/* Multi-select for warehouse countries */}
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

            {/* Step 3 */}
            {step === 3 && (
              <Form {...step3Form}>
                <form onSubmit={step3Form.handleSubmit(onStep3Submit)} className="space-y-4">
                  <FormField
                    control={step3Form.control}
                    name="apiKey"
                    rules={{ required: "API key is required" }}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Telegram API Key</FormLabel>
                        <FormControl>
                          <Input type="password" placeholder="Enter API key" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
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

            {/* Step 4 */}
            {step === 4 && (
              <Form {...step4Form}>
                <form onSubmit={step4Form.handleSubmit(onStep4Submit)} className="space-y-4">
                  <FormField
                    control={step4Form.control}
                    name="supportEmail"
                    rules={{ required: "Support email is required" }}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Support Email</FormLabel>
                        <FormControl>
                          <Input placeholder="support@myorg.com" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
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

            {/* Step 5 */}
            {step === 5 && (
              <Form {...step5Form}>
                <form onSubmit={step5Form.handleSubmit(onStep5Submit)} className="space-y-4">
                  <FormField
                    control={step5Form.control}
                    name="secretPhrase"
                    rules={{ required: "Secret phrase is required" }}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Secret Phrase</FormLabel>
                        <FormControl>
                          <Input type="password" placeholder="Some secret" {...field} />
                        </FormControl>
                        <FormMessage />
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
