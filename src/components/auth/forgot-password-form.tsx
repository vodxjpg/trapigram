"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { cn } from "@/lib/utils";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast"; // Import react-hot-toast

const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

export function ForgotPasswordForm({ className, ...props }: React.ComponentPropsWithoutRef<"form">) {
  const { register, handleSubmit, formState: { errors }, setError } = useForm<z.infer<typeof forgotPasswordSchema>>({
    resolver: zodResolver(forgotPasswordSchema),
  });

  async function onSubmit(data: z.infer<typeof forgotPasswordSchema>) {
    try {
      // Check if email exists using the custom API endpoint
      const checkResponse = await fetch(`/api/auth/check-email?email=${encodeURIComponent(data.email)}`);
      const checkData = await checkResponse.json();

      if (!checkResponse.ok) {
        if (checkResponse.status === 429) {
          // Handle rate limiting
          const retryAfter = checkResponse.headers.get("X-Retry-After");
          toast.error(`Too many requests. Retry after ${retryAfter} seconds.`); // Replace setError with toast
        } else {
          toast.error(checkData.error || "Failed to check email"); // Replace setError with toast
        }
        return;
      }

      if (!checkData.exists) {
        // Explicit error if email doesn't exist
        toast.error("Email not found"); // Replace setError with toast
        return;
      }

      // Proceed with sending the reset email
      const { error } = await authClient.forgetPassword({
        email: data.email,
        redirectTo: "/reset-password",
      });

      if (error) {
        console.error("Forgot password error:", error);
        toast.error(error.message || "Failed to send reset email"); // Replace setError with toast
      } else {
        console.log("Reset email sent");
        toast.success("Check your email for the reset link"); // Replace TODO with success toast
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
          Enter your email to receive a password reset link
        </p>
      </div>
      <div className="grid gap-6">
        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="m@example.com"
            {...register("email")}
            required
          />
          {errors.email && <p className="text-red-500 text-sm">{errors.email.message}</p>}
        </div>
        <Button type="submit" className="w-full">
          Send Reset Link
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