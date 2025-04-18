// src/app/(auth)/set-password/page.tsx
import { Suspense } from 'react';
import SetPasswordForm from '@/components/auth/set-password-form';

export default function SetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-8">
        <h1 className="text-2xl font-bold text-center">Set Password</h1>
        <p className="text-center text-muted-foreground">
          Please set a password to complete your account.
        </p>
        <Suspense fallback={<div>Loading password form...</div>}>
          <SetPasswordForm />
        </Suspense>
      </div>
    </div>
  );
}