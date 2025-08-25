// src/components/auth/set-password-form.tsx
"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function SetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const invitationId = searchParams.get("invitationId");

  /* ----------------------------------------------------------------
     Better-Auth renamed “isLoading” → “isPending”.
     We consume both so the code keeps working on any library version.
  ----------------------------------------------------------------- */
  const {
    data: session,
    isPending,
    isLoading,
  } = authClient.useSession() as {
    data: any;
    isPending?: boolean;
    isLoading?: boolean;
  };

  const loading = isPending ?? isLoading ?? false;

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  /* Redirect only when the session query has finished && no session */
  useEffect(() => {
    if (!loading && !session) {
      router.push("/login");
    }
  }, [loading, session, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        Checking session…
      </div>
    );
  }

  /* User already completed onboarding → nothing to do */
  if (session && !session.user.is_guest) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p>You already have a password set!</p>
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("Passwords do not match");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/internal/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error ?? "Failed to set password");
      }

      toast.success("Password set successfully!");

      // Redirect to organization selection after successfully setting the password
      router.push("/select-organization");
    } catch (err: any) {
      console.error("Error setting password:", err);
      toast.error(err.message ?? "Failed to set password");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="password">New Password</Label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="********"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirm">Confirm Password</Label>
        <Input
          id="confirm"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="********"
          required
        />
      </div>

      <Button type="submit" disabled={saving} className="w-full">
        {saving ? "Saving…" : "Set Password"}
      </Button>
    </form>
  );
}
