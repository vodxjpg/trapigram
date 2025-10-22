"use client";

import { useEffect, useState } from "react";
import { use } from "react";
import { useRouter } from "next/navigation"; // Import useRouter
import { ArrowLeft } from "lucide-react"; // Import ArrowLeft icon
import { Button } from "@/components/ui/button"; // Import Button
import { TermTable } from "./components/term-table";
import { useHeaderTitle } from "@/context/HeaderTitleContext";

type Attribute = {
  id: string;
  name: string;
  slug: string;
};

export default function AttributeTermsPage({ params }: { params: Promise<{ attributeId: string }> }) {
  const { setHeaderTitle } = useHeaderTitle();
  const [attribute, setAttribute] = useState<Attribute | null>(null);
  const [loading, setLoading] = useState(true);
  const { attributeId } = use(params);
  const router = useRouter(); // Initialize router

  useEffect(() => {
    const fetchAttribute = async () => {
      try {
        const response = await fetch(`/api/product-attributes/${attributeId}`, {
          credentials: "include",
        });
        if (!response.ok) throw new Error("Failed to fetch attribute");
        const data = await response.json();
        setAttribute(data);
        setHeaderTitle(`Terms for ${data.name}`);
      } catch (error) {
        console.error("Error fetching attribute:", error);
        setHeaderTitle("Attribute Terms");
      } finally {
        setLoading(false);
      }
    };

    fetchAttribute();
  }, [attributeId, setHeaderTitle]);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push("/product-attributes")}
          className="hover:bg-muted"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        {loading ? (
          <h1 className="text-3xl font-bold tracking-tight">Loading...</h1>
        ) : (
          <h1 className="text-3xl font-bold tracking-tight">
            Terms for {attribute?.name || "Unknown Attribute"}
          </h1>
        )}
      </div>
      <p className="text-muted-foreground">
        Manage terms for this attribute (e.g., Nike, Puma for Brand).
      </p>
      <TermTable attributeId={attributeId} />
    </div>
  );
}