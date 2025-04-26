"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import toast from "react-hot-toast";
import { authClient } from "@/lib/auth-client";

export function VerifyEmailForm() {
  const [email, setEmail] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    // Get email from localStorage or URL params if needed
    const storedEmail = localStorage.getItem("signup_email");
    if (storedEmail) {
      setEmail(storedEmail);
    }
  }, []);

  const handleResendEmail = async () => {
    if (!email) {
      toast.error("No email found. Please sign up again.");
      return;
    }

    try {
      const { data, error } = await authClient.sendVerificationEmail({
        email,
        callbackURL: "/login", // Redirect after verification
      });

      if (error) {
        toast.error(error.message || "Failed to resend verification email");
      } else {
        toast.success("Verification email resent!");
        setCooldown(60); // Start 60-second cooldown
      }
    } catch (err) {
      console.error("Unexpected error:", err);
      toast.error("An unexpected error occurred");
    }
  };

  useEffect(() => {
    if (cooldown > 0) {
      const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldown]);

  return (
    <div className="flex flex-col items-center gap-6">
      <h1 className="text-2xl font-bold">Verify your email</h1>
      <p className="text-center text-sm text-muted-foreground">
        We’ve sent a verification email to <strong>{email}</strong>. Please check your inbox and click the link to verify your account.
      </p>
      <Button onClick={handleResendEmail} disabled={cooldown > 0}>
        {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend Verification Email"}
      </Button>
      <div className="text-center text-sm">
        <a href="/login" className="underline underline-offset-4">
          Back to login
        </a>
      </div>
    </div>
  );
}