/*───────────────────────────────────────────────────────────────────
  src/components/auth/login-form.tsx          — FULL REPLACEMENT
───────────────────────────────────────────────────────────────────*/
"use client";

import { useForm }              from "react-hook-form";
import { zodResolver }          from "@hookform/resolvers/zod";
import { z }                    from "zod";
import toast                    from "react-hot-toast";
import { cn }                   from "@/lib/utils";
import { authClient }           from "@/lib/auth-client";
import { Button }               from "@/components/ui/button";
import { Input }                from "@/components/ui/input";
import { Label }                from "@/components/ui/label";
import { useRouter, useSearchParams } from "next/navigation";

const loginSchema = z.object({
  email   : z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required").optional(),
});

export function LoginForm(
  { className, ...props }: React.ComponentPropsWithoutRef<"form">,
) {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const invitationId = searchParams.get("invitationId");

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
  } = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
  });

  const passwordValue = watch("password");

  const go = (path: string) =>
    (window.location.href = path);

  async function onSubmit(data: z.infer<typeof loginSchema>) {
    try {
      /* quick email existence check */
      const chk = await fetch(`/api/auth/check-email?email=${encodeURIComponent(data.email)}`);
      const { exists, error } = await chk.json();
      if (!chk.ok) throw new Error(error || "Email check failed");
      if (!exists) {
        toast.error("Email not found");
        return;
      }

      /* ────────── PASSWORD SIGN-IN ────────── */
      if (data.password) {
        const { error: signErr } = await authClient.signIn.email({
          email   : data.email,
          password: data.password,
        });
        if (signErr) {
          toast.error(
            signErr.status === 403
              ? "Please verify your email first"
              : "Invalid email or password",
          );
          return;
        }

        /* 🔑  TERMINATE all other sessions right now */
        await authClient.revokeOtherSessions();

        go(invitationId
          ? `/accept-invitation/${invitationId}`
          : "/dashboard");
        return;
      }

      /* ────────── MAGIC-LINK SIGN-IN ────────── */
      const ml = await authClient.signIn.magicLink({
        email      : data.email,
        callbackURL: invitationId
          ? `/accept-invitation/${invitationId}`
          : "/dashboard",
      });
      if (ml.error) throw new Error(ml.error.message);

      toast.success("Magic link sent! Check your email.");
      router.push("/check-email");
    } catch (err: any) {
      console.error("login error:", err);
      toast.error(err.message || "Something went wrong");
    }
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className={cn("flex flex-col gap-6", className)}
      {...props}
    >
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-bold">Login to your account</h1>
        <p className="text-balance text-sm text-muted-foreground">
          Enter your email below to login to your account
        </p>
      </div>

      <div className="grid gap-6">
        {/* email */}
        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="m@example.com"
            {...register("email")}
            required
          />
          {errors.email && (
            <p className="text-red-500 text-sm">{errors.email.message}</p>
          )}
        </div>

        {/* password */}
        <div className="grid gap-2">
          <div className="flex items-center">
            <Label htmlFor="password">Password</Label>
            <a
              href="/forgot-password"
              className="ml-auto text-sm underline-offset-4 hover:underline"
            >
              Forgot your password?
            </a>
          </div>
          <Input
            id="password"
            type="password"
            placeholder="Please enter your password"
            {...register("password")}
          />
          {errors.password && (
            <p className="text-red-500 text-sm">{errors.password.message}</p>
          )}
        </div>

        <Button type="submit" className="w-full">
          {passwordValue ? "Login" : "Send magic link"}
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
