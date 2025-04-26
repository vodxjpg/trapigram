// src/app/(dashboard)/clients/[id]/page.tsx
"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import ClientDetailView from "./client-form-read-only";

export default function EditClientPage() {
  const params = useParams();
  const router = useRouter();
  const [client, setClient] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchClient = async () => {
      try {
        const response = await fetch(`/api/clients/${params.id}`, {
          headers: {
            "x-internal-secret":
              process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "",
          },
        });
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to fetch client");
        }
        const data = await response.json();
        setClient(data);
      } catch (error: any) {
        console.error("Error fetching client:", error);
        toast.error(error.message || "Failed to load client data");
        router.push("/clients");
      } finally {
        setLoading(false);
      }
    };
    fetchClient();
  }, [params.id, router]);

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/clients">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Client</h1>
          <p className="text-muted-foreground">Client information</p>
        </div>
      </div>
      <ClientDetailView />

      <div className="max-w-3xl mx-auto py-10">
        <div className="mb-4">
          <Button variant="outline" onClick={() => router.back()}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Ticket
          </Button>
        </div>
      </div>
    </div>
  );
}
