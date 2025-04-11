// src/app/(auth)/set-password/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function SetPasswordPage() {
  // 1) Use your custom authClient session hook
  const { data: session, isLoading } = authClient.useSession();
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center">Loading session...</div>;
  }

  // 2) If no session, you might want to show an error or push to /login
  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p>Not logged in.</p>
      </div>
    );
  }

  // 3) If user already has a password, either show a small note or do nothing:
  if (!session.user.is_guest) {
    // They are not a guest => they presumably have a password
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p>You already have a password set!</p>
      </div>
    );
  }

  // 4) Otherwise, show the set-password form
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      // We'll call your custom set-password route
      const response = await fetch("/api/internal/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to set password");
      }

      toast.success("Password set successfully");
      // After setting the password, you might want them to reload or go to /select-organization
      window.location.href = "/select-organization";
    } catch (error) {
      console.error("Error setting password:", error);
      toast.error(error.message || "Failed to set password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-8">
        <h1 className="text-2xl font-bold text-center">Set Your Password</h1>
        <p className="text-center text-muted-foreground">
          Please set a password to complete your account setup.
        </p>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm Password</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm your password"
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Setting Password..." : "Set Password"}
          </Button>
        </form>
      </div>
    </div>
  );
}
