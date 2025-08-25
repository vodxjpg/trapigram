
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export default function ChangeSecretPhrasePage() {
  const router = useRouter();

  // session  active organization
  const { data: session, isPending: sLoading, isLoading: sLoadingAlt } =
    (authClient.useSession() as any) || {};
  const loadingSession = sLoading ?? sLoadingAlt ?? false;

  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  const [step, setStep] = useState<1 | 2>(1);
  const [verifying, setVerifying] = useState(false);
  const [updating, setUpdating] = useState(false);

  // step 1 fields
  const [password, setPassword] = useState("");

  // step 2 fields
  const [secret, setSecret] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => {
    if (!loadingSession && !session) {
      router.replace("/login");
    }
  }, [loadingSession, session, router]);

  const reauth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.user?.email) {
      toast.error("Missing user email");
      return;
    }
    setVerifying(true);
    try {
      /**
       * Re-authenticate by calling the built-in sign-in endpoint with the current
       * user's email  the entered password. This will validate the credentials.
       * If valid, we proceed to step 2. (It may refresh session cookies, which is OK.)
       */
      const res = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: session.user.email,
          password,
          // many auth handlers ignore this, but include to avoid navigations
          redirect: false,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "Invalid password");
      }
      toast.success("Password verified");
      setStep(2);
    } catch (err: any) {
      toast.error(err.message || "Password verification failed");
    } finally {
      setVerifying(false);
    }
  };

  const submitNewSecret = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organizationId) {
      toast.error("No active organization selected");
      return;
    }
    if (!secret || secret !== confirm) {
      toast.error("Secret phrases do not match");
      return;
    }
    setUpdating(true);
    try {
      const res = await fetch("/api/organizations/change-secret-phrase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secretPhrase: secret }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error || "Failed to update secret");
      }
      toast.success("Secret phrase updated");
      router.replace("/organizations"); // go back to orgs list (adjust if needed)
    } catch (err: any) {
      toast.error(err.message || "Could not update secret phrase");
    } finally {
      setUpdating(false);
    }
  };

  if (loadingSession || !session) return null;

  return (
    <div className="container mx-auto max-w-xl py-10">
      <Card>
        <CardHeader>
          <CardTitle>
            {step === 1 ? "Re-authenticate" : "Set New Secret Phrase"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {step === 1 && (
            <form onSubmit={reauth} className="space-y-4">
              <div className="space-y-2">
                <Label>Email</Label>
                <Input value={session.user.email} disabled />
              </div>
              <div className="space-y-2">
                <Label>Password</Label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                />
              </div>
              <Button type="submit" disabled={verifying} className="w-full">
                {verifying ? "Verifying…" : "Verify password"}
              </Button>
            </form>
          )}

          {step === 2 && (
            <form onSubmit={submitNewSecret} className="space-y-4">
              <div className="space-y-2">
                <Label>New Secret Phrase</Label>
                <div className="relative">
                  <Input
                    type={showSecret ? "text" : "password"}
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder="Enter new secret phrase"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret((v) => !v)}
                    className="absolute right-2 top-2 text-sm text-gray-500"
                  >
                    {showSecret ? "Hide" : "Show"}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Confirm Secret Phrase</Label>
                <Input
                  type={showSecret ? "text" : "password"}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Re-enter secret phrase"
                  required
                />
              </div>
              <Button type="submit" disabled={updating} className="w-full">
                {updating ? "Saving…" : "Save new secret"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
