"use client";

import { useEffect, useRef, useState } from "react";
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

const codeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
});

const updateSchema = z.object({
  secretPhrase: z.string().min(1, "Secret phrase is required"),
});

type CodeValues = z.infer<typeof codeSchema>;
type UpdateValues = z.infer<typeof updateSchema>;

function generateSecurePhrase() {
  const rand = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...rand));
}

export default function ChangeOrgSecretPage() {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const email = session?.user?.email || "";

  const [step, setStep] = useState<"request" | "verify" | "update">("request");
  const [busy, setBusy] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState<number>(0);
  const cooldownRef = useRef<NodeJS.Timeout | null>(null);

  const codeForm = useForm<CodeValues>({
    resolver: zodResolver(codeSchema),
    defaultValues: { code: "" },
  });

  const updateForm = useForm<UpdateValues>({
    resolver: zodResolver(updateSchema),
    defaultValues: { secretPhrase: "" },
  });

  useEffect(() => {
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    };
  }, []);

  async function sendCode() {
    if (!email) {
      toast.error("No email found for your session.");
      return;
    }
    try {
      setBusy(true);
      const res = await fetch("/api/organizations/change-secret/send-code", {
        method: "POST",
        credentials: "include",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Failed to send code");

      toast.success("Verification code sent to your email");
      setStep("verify");

      // 60s cooldown for re-sends
      setCooldown(60);
      cooldownRef.current = setInterval(() => {
        setCooldown((s) => {
          if (s <= 1 && cooldownRef.current) clearInterval(cooldownRef.current);
          return Math.max(0, s - 1);
        });
      }, 1000);
    } catch (e: any) {
      toast.error(e?.message || "Could not send code");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(values: CodeValues) {
    try {
      setBusy(true);
      const res = await fetch("/api/organizations/change-secret/verify-code", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: values.code }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Invalid or expired code");

      setTicketId(body.ticketId);
      toast.success("Code verified");
      setStep("update");
    } catch (e: any) {
      toast.error(e?.message || "Invalid or expired code");
    } finally {
      setBusy(false);
    }
  }

  async function onUpdate(values: UpdateValues) {
    if (!ticketId) {
      toast.error("Missing verification ticket");
      return;
    }
    try {
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
      toast.error(err?.message || "Failed to update secret");
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
          {step === "request" && "We'll email you a 6-digit code to confirm it's you."}
          {step === "verify" && `Enter the 6-digit code we sent to ${email}.`}
          {step === "update" && "Now set your new secret phrase."}
        </p>

        {step === "request" && (
          <div className="space-y-4">
            <div>
              <FormLabel>Email</FormLabel>
              <Input value={email} readOnly />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => router.back()} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={sendCode} disabled={busy}>
                Send code
              </Button>
            </div>
          </div>
        )}

        {step === "verify" && (
          <Form {...codeForm}>
            <form onSubmit={codeForm.handleSubmit(verifyCode)} className="space-y-4">
              <FormField
                control={codeForm.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Verification code</FormLabel>
                    <FormControl>
                      <Input inputMode="numeric" placeholder="123456" maxLength={6} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex items-center justify-between">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep("request")}
                  disabled={busy}
                >
                  Back
                </Button>
                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={sendCode}
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
                onClick={() => updateForm.setValue("secretPhrase", generateSecurePhrase())}
                disabled={busy}
              >
                Generate Secure Phrase
              </Button>
              <p className="text-xs text-muted-foreground">
                This phrase will be encrypted on the server and stored for your organization. Don’t
                lose it—some actions will require it.
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
