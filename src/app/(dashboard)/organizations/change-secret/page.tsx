"use client";

export const dynamic = "force-dynamic"; // avoid SSG/ISR on this client-only page

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

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
// Schemas
// ─────────────────────────────────────────────────────────────
const codeSchema = z.object({
  code: z
    .string()
    .regex(/^\d{6}$/, "Enter the 6-digit code we emailed you"),
});

const updateSchema = z.object({
  secretPhrase: z.string().min(1, "Secret phrase is required"),
});

type CodeValues = z.infer<typeof codeSchema>;
type UpdateValues = z.infer<typeof updateSchema>;

// Utility
function generateSecurePhrase() {
  const rand = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...rand));
}

const COOLDOWN_SECONDS = 60;
const COOLDOWN_KEY = "changeSecretCooldownAt";

export default function ChangeOrgSecretPage() {
  const router = useRouter();

  const [step, setStep] = useState<"request" | "verify" | "update">("request");
  const [busy, setBusy] = useState(false);
  const [ticketId, setTicketId] = useState<string | null>(null);

  // resend cooldown
  const [cooldown, setCooldown] = useState<number>(0);

  const codeForm = useForm<CodeValues>({
    resolver: zodResolver(codeSchema),
    defaultValues: { code: "" },
  });

  const updateForm = useForm<UpdateValues>({
    resolver: zodResolver(updateSchema),
    defaultValues: { secretPhrase: "" },
  });

  // Restore cooldown on mount (persisted in localStorage)
  useEffect(() => {
    try {
      const ts = localStorage.getItem(COOLDOWN_KEY);
      if (ts) {
        const elapsed = Math.floor((Date.now() - Number(ts)) / 1000);
        const left = Math.max(0, COOLDOWN_SECONDS - elapsed);
        if (left > 0) setCooldown(left);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Tick down the cooldown
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => {
      setCooldown((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  function startCooldown() {
    setCooldown(COOLDOWN_SECONDS);
    try {
      localStorage.setItem(COOLDOWN_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Step 1: Request a code via email
  // ─────────────────────────────────────────────────────────────
  async function requestCode() {
    try {
      setBusy(true);
      const resp = await fetch("/api/organizations/change-secret/send-code", {
        method: "POST",
        credentials: "include",
      });
      const body = await resp.json();
      if (!resp.ok) throw new Error(body?.error || "Failed to send code");

      toast.success("Verification code sent to your email");
      startCooldown();
      setStep("verify");
    } catch (err: any) {
      toast.error(err?.message || "Failed to send code");
    } finally {
      setBusy(false);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Step 2: Verify the 6-digit code → receive ticketId
  // ─────────────────────────────────────────────────────────────
  async function onVerify(values: CodeValues) {
    try {
      setBusy(true);
      const resp = await fetch("/api/organizations/change-secret/verify-code", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: values.code }),
      });
      const body = await resp.json();
      if (!resp.ok || !body?.ticketId) {
        throw new Error(body?.error || "Invalid or expired code");
      }
      setTicketId(body.ticketId);
      toast.success("Code verified");
      setStep("update");
    } catch (err: any) {
      toast.error(err?.message || "Failed to verify code");
    } finally {
      setBusy(false);
    }
  }

  // Resend (same endpoint as initial request)
  async function resendCode() {
    try {
      if (cooldown > 0) return;
      setBusy(true);
      const resp = await fetch("/api/organizations/change-secret/send-code", {
        method: "POST",
        credentials: "include",
      });
      const body = await resp.json();
      if (!resp.ok) throw new Error(body?.error || "Failed to resend code");

      toast.success("New code sent");
      startCooldown();
    } catch (err: any) {
      toast.error(err?.message || "Failed to resend code");
    } finally {
      setBusy(false);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Step 3: Submit new secret phrase with ticketId
  // ─────────────────────────────────────────────────────────────
  async function onUpdate(values: UpdateValues) {
    try {
      if (!ticketId) {
        toast.error("Missing verification ticket");
        return;
      }
      setBusy(true);
      const resp = await fetch("/api/organizations/secret-phrase", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secretPhrase: values.secretPhrase,
          ticketId,
        }),
      });
      const body = await resp.json();
      if (!resp.ok) throw new Error(body?.error || "Failed to update secret");

      toast.success("Organization secret phrase updated");
      router.push("/organizations");
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
          {step === "request" &&
            "We’ll email you a 6-digit code to verify this change."}
          {step === "verify" &&
            "Enter the 6-digit code we emailed you."}
          {step === "update" &&
            "Set your new secret phrase."}
        </p>

        {step === "request" && (
          <div className="space-y-4">
            <Button
              className="w-full"
              onClick={requestCode}
              disabled={busy || cooldown > 0}
            >
              {cooldown > 0 ? `Try again in ${cooldown}s` : "Send verification code"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => router.back()}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        )}

        {step === "verify" && (
          <Form {...codeForm}>
            <form onSubmit={codeForm.handleSubmit(onVerify)} className="space-y-4">
              <FormField
                control={codeForm.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>6-digit code</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="123456"
                        onChange={(e) => {
                          const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                          field.onChange(v);
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep("request")}
                  disabled={busy}
                >
                  Back
                </Button>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={resendCode}
                    disabled={busy || cooldown > 0}
                  >
                    {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
                  </Button>
                  <Button type="submit" disabled={busy}>
                    Verify
                  </Button>
                </div>
              </div>
            </form>
          </Form>
        )}

        {step === "update" && (
          <Form {...updateForm}>
            <form onSubmit={updateForm.handleSubmit(onUpdate)} className="space-y-4">
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
                          type="password"
                          placeholder="Enter new secret phrase"
                        />
                      </FormControl>
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
