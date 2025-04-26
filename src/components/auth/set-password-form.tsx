// src/app/(auth)/set-password/SetPasswordForm.tsx
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

  // If you passed "invitationId" in the query, grab it:
  const invitationId = searchParams.get("invitationId");

  const { data: session, isLoading } = authClient.useSession();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isLoading && !session) {
      // If there's no session at all, push to /login
      router.push("/login");
    }
  }, [isLoading, session, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        Checking session...
      </div>
    );
  }

  // If user *is* logged in, but not a guest, they presumably have a password
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
    setLoading(true);

    try {
      // We'll call your internal route to set the password
      const res = await fetch("/api/internal/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to set password");
      }

      toast.success("Password set successfully!");

      // Now that user has a password and is_guest = false, 
      // we want to let them accept the invitation if needed:
      if (invitationId) {
        // Go back to the invitation route to finalize acceptance
        router.push(`/accept-invitation/${invitationId}`);
      } else {
        // If no invitation, do your normal flow
        router.push("/dashboard"); 
      }
    } catch (error: any) {
      console.error("Error setting password:", error);
      toast.error(error.message || "Failed to set password");
    } finally {
      setLoading(false);
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

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Saving..." : "Set Password"}
      </Button>
    </form>
  );
}