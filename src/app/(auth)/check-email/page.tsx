// /home/zodx/Desktop/trapigram/src/app/(auth)/check-email/page.tsx
"use client";

export default function CheckEmail() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-8 text-center">
        <h1 className="text-2xl font-bold">Check Your Email</h1>
        <p className="text-muted-foreground">
          We’ve sent a magic link to your email. Please click the link to sign in and accept your invitation.
        </p>
      </div>
    </div>
  );
}