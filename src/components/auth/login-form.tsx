// /home/zodx/Desktop/trapigram/src/components/auth/login-form.tsx
"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import toast from "react-hot-toast";
import { cn } from "@/lib/utils";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required").optional(),
});

export function LoginForm({ className, ...props }: React.ComponentPropsWithoutRef<"form">) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const invitationId = searchParams.get("invitationId");

  const { register, handleSubmit, formState: { errors }, setValue, watch } = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
  });

  const passwordValue = watch("password"); // Watch the password field to determine button text

  async function onSubmit(data: z.infer<typeof loginSchema>) {
    try {
      const checkResponse = await fetch(`/api/auth/check-email?email=${encodeURIComponent(data.email)}`);
      const checkData = await checkResponse.json();

      if (!checkResponse.ok) {
        if (checkResponse.status === 429) {
          const retryAfter = checkResponse.headers.get("X-Retry-After");
          toast.error(`Too many requests. Retry after ${retryAfter} seconds.`);
        } else {
          toast.error(checkData.error || "Failed to check email");
        }
        return;
      }

      if (!checkData.exists) {
        toast.error("Email not found");
        return;
      }

      if (data.password) {
        // Email/Password Login
        const { data: response, error } = await authClient.signIn.email({
          email: data.email,
          password: data.password,
        });

        if (error) {
          if (error.status === 403) {
            toast.error("Please verify your email first");
          } else {
            toast.error("Invalid email or password");
          }
          console.error("Login error:", error);
        } else {
          console.log("Login successful:", response);
          window.location.href = invitationId ? `/accept-invitation/${invitationId}` : "/dashboard";
        }
      } else {
        // Magic Link Login
        const response = await authClient.signIn.magicLink({
          email: data.email,
          callbackURL: invitationId ? `/accept-invitation/${invitationId}` : "/dashboard",
        });

        if (response.error) {
          throw new Error(response.error.message);
        }

        toast.success("Magic link sent! Check your email.");
        router.push("/check-email");
      }
    } catch (err) {
      console.error("Unexpected error:", err);
      toast.error("Something went wrong");
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className={cn("flex flex-col gap-6", className)} {...props}>
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-bold">Login to your account</h1>
        <p className="text-balance text-sm text-muted-foreground">
          Enter your email below to login to your account
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
        <div className="grid gap-2">
          <div className="flex items-center">
            <Label htmlFor="password">Password (optional)</Label>
            <a href="/forgot-password" className="ml-auto text-sm underline-offset-4 hover:underline">
              Forgot your password?
            </a>
          </div>
          <Input
            id="password"
            type="password"
            {...register("password")}
            placeholder="Leave blank for magic link"
          />
          {errors.password && <p className="text-red-500 text-sm">{errors.password.message}</p>}
        </div>
        <Button type="submit" className="w-full">
          {passwordValue ? "Login" : "Send Magic Link"}
        </Button>
      </div>
      <div className="text-center text-sm">
        Don’t have an account?{" "}
        <a href="/sign-up" className="underline underline-offset-4">
          Sign up
        </a>
      </div>
    </form>
  );
}