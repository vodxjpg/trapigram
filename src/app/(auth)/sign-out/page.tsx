"use client";

import { useEffect } from "react";
import { authClient } from "@/lib/auth-client";

export default function SignOutPage() {
  useEffect(() => {
    authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          window.location.href = "/login";
        },
      },
    });
  }, []);

  return <p className="text-center">Signing you out...</p>;
}