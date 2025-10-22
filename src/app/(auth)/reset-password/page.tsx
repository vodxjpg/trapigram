// src/app/(auth)/reset-password/page.tsx
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import Globe from "@/components/Globe";

export default async function ResetPasswordPage({
  searchParams,
}: {
  // ❗ Next 15 expects a Promise here
  searchParams?: Promise<any>;
}) {
  const sp = (searchParams ? await searchParams : {}) as Record<
    string,
    string | string[] | undefined
  >;

  const raw = sp?.token;
  const token =
    typeof raw === "string"
      ? (raw.trim() || null)
      : Array.isArray(raw)
      ? ((raw[0] ?? "").trim() || null)
      : null;

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Left */}
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <a href="#" className="flex items-center gap-2 font-medium">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground" />
            Trapyfy.
          </a>
        </div>

        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-xs">
            <ResetPasswordForm token={token} />
          </div>
        </div>
      </div>

      {/* Right */}
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
