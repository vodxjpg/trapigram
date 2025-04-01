"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import zxcvbn from "zxcvbn";
import countriesLib from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";
import { getCountryCallingCode, getCountries } from "libphonenumber-js";
import ReactCountryFlag from "react-country-flag";
import { cn } from "@/lib/utils";
import { authClient } from "@/lib/auth-client";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import toast from "react-hot-toast";
import { useSearchParams } from "next/navigation";

// Register the English locale for country names
countriesLib.registerLocale(enLocale);

const countries = countriesLib.getNames("en");
const supportedCountryCodes = getCountries();
const countryOptions = supportedCountryCodes
  .map((code) => {
    const name = countries[code];
    if (!name) return null;
    return {
      value: code,
      label: name,
      dialingCode: `+${getCountryCallingCode(code)}`,
    };
  })
  .filter(Boolean)
  .sort((a, b) => a.label.localeCompare(b.label));

const formSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
  country: z.string().refine((val) => supportedCountryCodes.includes(val), {
    message: "Please select a valid country",
  }),
  phone: z.string().min(5, "Phone number is too short").max(15, "Phone number is too long"),
  password: z.string().min(8, "Password must be at least 8 characters").refine(
    (val) => zxcvbn(val).score >= 3,
    { message: "Password is too weak" }
  ),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

export function SignUpForm({ className, ...props }: React.ComponentPropsWithoutRef<"form">) {
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      country: "",
      phone: "",
      password: "",
      confirmPassword: "",
    },
  });

  const searchParams = useSearchParams();
  const preSelectedTier = searchParams.get("tier");

  const [passwordStrength, setPasswordStrength] = React.useState(0);
  const [selectedCountry, setSelectedCountry] = React.useState<string | null>(null);

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newPassword = e.target.value;
    form.setValue("password", newPassword);
    if (newPassword) {
      const evaluation = zxcvbn(newPassword);
      setPasswordStrength(evaluation.score);
    } else {
      setPasswordStrength(0);
    }
  };

  const getStrengthLabel = (score: number) => {
    switch (score) {
      case 0: return "Very Weak";
      case 1: return "Weak";
      case 2: return "Fair";
      case 3: return "Strong";
      case 4: return "Very Strong";
      default: return "";
    }
  };

  const handleCountryChange = (countryCode: string) => {
    setSelectedCountry(countryCode);
    form.setValue("country", countryCode);
  };

  const dialingCode = selectedCountry
    ? countryOptions.find((option) => option.value === selectedCountry)?.dialingCode || ""
    : "";

  async function onSubmit(values: z.infer<typeof formSchema>) {
    try {
      const checkResponse = await fetch(`/api/auth/check-email?email=${encodeURIComponent(values.email)}`);
      const checkData = await checkResponse.json();

      if (!checkResponse.ok) {
        if (checkResponse.status === 429) {
          const retryAfter = checkResponse.headers.get("X-Retry-After");
          toast.error(`Too many requests. Retry after ${retryAfter} seconds.`);
        } else {
          toast.error(checkData.error || "Failed to check email");
        }
        return;
      }

      if (checkData.exists) {
        toast.error("Email already in use");
        return;
      }

      const fullName = `${values.firstName} ${values.lastName}`;
      const fullPhone = `${dialingCode}${values.phone}`; // Use dialingCode derived from country

      const { data, error } = await authClient.signUp.email({
        email: values.email,
        password: values.password,
        name: fullName,
        phone: fullPhone,
        country: values.country,
        is_guest: false,
        tier: preSelectedTier || undefined,
      });

      if (error) {
        console.error("Sign-up error:", error);
        toast.error(error.message || "Sign-up failed");
      } else {
        console.log("Sign-up successful, verification email sent:", data);
        toast.success("Sign-up successful! Check your email to verify.");
        localStorage.setItem("signup_email", values.email); // Store email for verify page
        window.location.href = "/verify-email"; // Redirect to verify-email
      }
    } catch (err) {
      console.error("Unexpected error:", err);
      toast.error("An unexpected error occurred");
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className={cn("flex flex-col gap-6", className)} {...props}>
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-2xl font-bold">Create your account</h1>
          <p className="text-balance text-sm text-muted-foreground">
            Enter your details below to create your account
          </p>
        </div>
        <div className="grid gap-6">
          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="firstName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>First Name</FormLabel>
                  <FormControl>
                    <Input placeholder="John" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="lastName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Last Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Doe" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input type="email" placeholder="m@example.com" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="country"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Country</FormLabel>
                <FormControl>
                  <Select onValueChange={(value) => handleCountryChange(value)} defaultValue={field.value}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select a country" />
                    </SelectTrigger>
                    <SelectContent>
                      {countryOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          <div className="flex items-center gap-2">
                            <ReactCountryFlag countryCode={option.value} svg />
                            {option.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid grid-cols-[auto_1fr] gap-4">
            <FormItem>
              <FormLabel>Dialing Code</FormLabel>
              <Input
                type="text"
                value={dialingCode}
                readOnly
                className="w-[120px]"
              />
            </FormItem>
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone Number</FormLabel>
                  <FormControl>
                    <Input type="tel" placeholder="1234567890" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="••••••••"
                      {...field}
                      onChange={handlePasswordChange}
                    />
                  </FormControl>
                  <FormMessage />
                  {field.value && (
                    <p className="text-sm mt-1">
                      Strength: <strong>{getStrengthLabel(passwordStrength)}</strong>
                    </p>
                  )}
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirm Password</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="••••••••" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <Button type="submit" className="w-full">
            Sign Up
          </Button>
        </div>
        <div className="text-center text-sm">
          Already have an account?{" "}
          <a href="/login" className="underline underline-offset-4">
            Log in
          </a>
        </div>
      </form>
    </Form>
  );
}