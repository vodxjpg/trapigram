import { GalleryVerticalEnd } from "lucide-react";
import { LoginForm } from "@/components/auth/login-form";
import Globe from "@/components/Globe";
import { Suspense } from 'react'; // Added Suspense import

export default function LoginPage() {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Left side: Logo + Form */}
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <a href="#" className="flex items-center gap-2 font-medium">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <GalleryVerticalEnd className="size-4" />
            </div>
            Trapigram.
          </a>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-xs">
            <Suspense fallback={<div>Loading login form...</div>}>
              <LoginForm />
            </Suspense>
          </div>
        </div>
      </div>

      {/* Right side: Globe + Headline */}
      <div className="relative hidden bg-black lg:flex flex-col items-center justify-center">
        <div className="relative w-full h-[600px] flex items-center justify-center">
          {/* Globe in the background */}
          <Globe />
          {/* Headline absolutely positioned at the bottom center */}
          <h2 className="absolute bottom-8 left-1/2 -translate-x-1/2 text-white text-center text-5xl font-bold">
            Sell anything easily around the globe
          </h2>
        </div>
      </div>
    </div>
  );
}