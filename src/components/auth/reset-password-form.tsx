"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import zxcvbn from "zxcvbn";
import { cn } from "@/lib/utils";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast"; // Import react-hot-toast

const resetPasswordSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters").refine(
    (val) => zxcvbn(val).score >= 3,
    { message: "Password is too weak" }
  ),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

export function ResetPasswordForm({ token, className, ...props }: { token: string | null } & React.ComponentPropsWithoutRef<"form">) {
  const { register, handleSubmit, formState: { errors }, setError, watch } = useForm<z.infer<typeof resetPasswordSchema>>({
    resolver: zodResolver(resetPasswordSchema),
  });

  const [passwordStrength, setPasswordStrength] = useState(0);

  // Update password strength in real-time
  const password = watch("password");
  useEffect(() => {
    if (password) {
      const evaluation = zxcvbn(password);
      setPasswordStrength(evaluation.score);
    } else {
      setPasswordStrength(0);
    }
  }, [password]);

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

  async function onSubmit(data: z.infer<typeof resetPasswordSchema>) {
    if (!token) {
      toast.error("Invalid or missing token"); // Replace setError with toast
      return;
    }

    try {
      const { error } = await authClient.resetPassword({
        newPassword: data.password,
        token,
      });

      if (error) {
        console.error("Reset password error:", error);
        toast.error(error.message || "Failed to reset password"); // Replace setError with toast
      } else {
        console.log("Password reset successful");
        toast.success("Password reset successful! Redirecting to login..."); // Add success toast
        setTimeout(() => {
          window.location.href = "/login"; // Redirect after 2 seconds
        }, 2000); // Delay to show the toast
      }
    } catch (err) {
      console.error("Unexpected error:", err);
      toast.error("An unexpected error occurred"); // Replace setError with toast
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className={cn("flex flex-col gap-6", className)} {...props}>
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-bold">Reset your password</h1>
        <p className="text-balance text-sm text-muted-foreground">
          Enter your new password below
        </p>
      </div>
      <div className="grid gap-6">
        <div className="grid gap-2">
          <Label htmlFor="password">New Password</Label>
          <Input
            id="password"
            type="password"
            {...register("password")}
            required
          />
          {errors.password && <p className="text-red-500 text-sm">{errors.password.message}</p>}
          {password && (
            <p className="text-sm mt-1">
              Strength: <strong>{getStrengthLabel(passwordStrength)}</strong>
            </p>
          )}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="confirmPassword">Confirm Password</Label>
          <Input
            id="confirmPassword"
            type="password"
            {...register("confirmPassword")}
            required
          />
          {errors.confirmPassword && <p className="text-red-500 text-sm">{errors.confirmPassword.message}</p>}
        </div>
        <Button type="submit" className="w-full">
          Reset Password
        </Button>
      </div>
      <div className="text-center text-sm">
        Remember your password?{" "}
        <a href="/login" className="underline underline-offset-4">
          Log in
        </a>
      </div>
    </form>
  );
}