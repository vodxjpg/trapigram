"use client";

import { ClientForm } from "../client-form";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { usePermission } from "@/hooks/use-permission";
import { useRouter } from "next/navigation";

export default function NewClientPage() {
  const can = usePermission();
  const router = useRouter();
  if (can.loading) return null;
  if (!can({ customer: ["create"] })) {
    router.replace("/clients");
    return null;
  }

  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/clients">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Add New Client
          </h1>
          <p className="text-muted-foreground">
            Create a new client in your database
          </p>
        </div>
      </div>
      <ClientForm />
    </div>
  );
}
