/* -------------------------------------------------------------------------- */
/*  /home/zodx/Desktop/Trapyfy/src/app/(auth)/reset-password/page.tsx       */
/* -------------------------------------------------------------------------- */

import { GalleryVerticalEnd } from "lucide-react";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import Globe from "@/components/Globe";

/**
 * The `searchParams` prop is injected by the Next 15 App Router.
 * We pull the token out of the URL and pass it straight to
 * <ResetPasswordForm/>.  Without this, the form has no token and
 * Better Auth quite rightly reports “Invalid or missing token”.
 */
export default function ResetPasswordPage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  const token =
    typeof searchParams?.token === "string" && searchParams.token.trim() !== ""
      ? searchParams.token
      : null;

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* ───────────────────────────────────────── Left side ───────────────────────────────────────── */}
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <a href="#" className="flex items-center gap-2 font-medium">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <GalleryVerticalEnd className="size-4" />
            </div>
            Trapyfy.
          </a>
        </div>

        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-xs">
            {/* ←――――――――――――――――――  pass the token here  ――――――――――――――――――→ */}
            <ResetPasswordForm token={token} />
          </div>
        </div>
      </div>

      {/* ───────────────────────────────────────── Right side ──────────────────────────────────────── */}
      <div className="relative hidden bg-black lg:flex flex-col items-center justify-center">
        <div className="relative w-full h-[600px] flex items-center justify-center">
          <Globe />
          <h2 className="absolute bottom-8 left-1/2 -translate-x-1/2 text-white text-center text-5xl font-bold">
            Sell anything easily around the globe
          </h2>
        </div>
      </div>
    </div>
  );
}
