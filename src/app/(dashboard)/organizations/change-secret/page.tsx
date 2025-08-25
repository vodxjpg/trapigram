"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

// ─────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────
const verifySchema = z.object({
  password: z.string().min(1, "Password is required"),
});

const updateSchema = z.object({
  secretPhrase: z.string().min(1, "Secret phrase is required"),
});

type VerifyValues = z.infer<typeof verifySchema>;
type UpdateValues = z.infer<typeof updateSchema>;

// Utility
function generateSecurePhrase() {
  const rand = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...rand));
}

export default function ChangeOrgSecretPage() {
  const router = useRouter();
  const { data: session } = authClient.useSession(); // needs Better Auth React hooks
  const email = session?.user?.email || "";

  const [step, setStep] = useState<"verify" | "update">("verify");
  const [showPw, setShowPw] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [busy, setBusy] = useState(false);

  const verifyForm = useForm<VerifyValues>({
    resolver: zodResolver(verifySchema),
    defaultValues: { password: "" },
  });

  const updateForm = useForm<UpdateValues>({
    resolver: zodResolver(updateSchema),
    defaultValues: { secretPhrase: "" },
  });

  // ─────────────────────────────────────────────────────────────
  // Step 1: Re-auth with Better Auth (email  password)
  // This calls POST /api/auth/sign-in/email via the client.
  // Docs show: authClient.signIn.email({ email, password })
  // https://www.better-auth.com/docs/plugins/email
  // ─────────────────────────────────────────────────────────────
  async function onVerify(values: VerifyValues) {
    try {
      if (!email) {
        toast.error("Missing email for current session.");
        return;
      }
      setBusy(true);
      const res = await authClient.signIn.email({
        email,
        password: values.password,
      });
      if (res?.data?.session) {
        toast.success("Re-authentication successful");
        setStep("update");
      } else {
        throw new Error(res?.error?.message || "Invalid credentials");
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to verify password");
    } finally {
      setBusy(false);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Step 2: Send new phrase to our org endpoint (session-scoped)
  // This endpoint uses getContext() to find the active organization.
  // ─────────────────────────────────────────────────────────────
  async function onUpdate(values: UpdateValues) {
    try {
      setBusy(true);
      const resp = await fetch("/api/organizations/secret-phrase", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secretPhrase: values.secretPhrase }),
      });
      const body = await resp.json();
      if (!resp.ok) {
        throw new Error(body?.error || "Failed to update secret phrase");
      }
      toast.success("Organization secret phrase updated");
      router.push("/organizations"); // adjust to your list route
    } catch (err: any) {
      toast.error(err?.message || "Failed to update secret phrase");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-center min-h-[70vh] p-4">
      <div className="w-full max-w-md bg-white p-6 rounded-lg border">
        <h1 className="text-xl font-semibold mb-1">
          Change Organization Secret Phrase
        </h1>
        <p className="text-sm text-muted-foreground mb-6">
          {step === "verify"
            ? "First, confirm your password."
            : "Now set your new secret phrase."}
        </p>

        {step === "verify" && (
          <Form {...verifyForm}>
            <form
              onSubmit={verifyForm.handleSubmit(onVerify)}
              className="space-y-4"
            >
              <FormField
                control={verifyForm.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <div className="relative">
                      <FormControl>
                        <Input
                          {...field}
                          type={showPw ? "text" : "password"}
                          placeholder="••••••••"
                        />
                      </FormControl>
                      <button
                        className="absolute right-2 top-2 text-xs text-gray-500"
                        type="button"
                        onClick={() => setShowPw((s) => !s)}
                      >
                        {showPw ? "Hide" : "Show"}
                      </button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.back()}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={busy}>
                  Continue
                </Button>
              </div>
            </form>
          </Form>
        )}

        {step === "update" && (
          <Form {...updateForm}>
            <form
              onSubmit={updateForm.handleSubmit(onUpdate)}
              className="space-y-4"
            >
              <FormField
                control={updateForm.control}
                name="secretPhrase"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>New Secret Phrase</FormLabel>
                    <div className="relative">
                      <FormControl>
                        <Input
                          {...field}
                          type={showSecret ? "text" : "password"}
                          placeholder="Enter new secret phrase"
                        />
                      </FormControl>
                      <button
                        className="absolute right-2 top-2 text-xs text-gray-500"
                        type="button"
                        onClick={() => setShowSecret((s) => !s)}
                      >
                        {showSecret ? "Hide" : "Show"}
                      </button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() =>
                  updateForm.setValue("secretPhrase", generateSecurePhrase())
                }
                disabled={busy}
              >
                Generate Secure Phrase
              </Button>
              <p className="text-xs text-muted-foreground">
                This phrase will be encrypted on the server and stored for your
                organization. Don’t lose it—some actions will require it.
              </p>
              <div className="flex justify-between">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep("verify")}
                  disabled={busy}
                >
                  Back
                </Button>
                <Button type="submit" disabled={busy}>
                  Save Secret Phrase
                </Button>
              </div>
            </form>
          </Form>
        )}
      </div>
    </div>
  );
}
