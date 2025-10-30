"use client";

import { useEffect, useState } from "react";
import { use } from "react";
import { useRouter } from "next/navigation"; // Import useRouter
import { TermTable } from "./components/term-table";

// Reusable info tooltip + dialog component
import InfoHelpDialog from "@/components/dashboard/info-help-dialog";
import { PageHeader } from "@/components/page-header";
import { useHeaderTitle } from "@/context/HeaderTitleContext"

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
    <div className="container mx-auto py-6 px-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div>
            <PageHeader
              title={`Terms for ${attribute?.name || "Unknown Attribute"}`}
              description="Manage terms for this attribute (e.g., Nike, Puma for Brand)." />
          </div>
          {/* Use InfoHelpDialog with the new `content` prop */}
          <InfoHelpDialog
            title="About attribute terms"
            tooltip="What are attribute terms?"
            content={
              <>
                <p>
                  <strong>Attribute terms</strong> are the predefined values for a specific attribute. For example, for the <em>Brand</em> attribute you might create terms like <em>Nike</em> or <em>Puma</em>; for <em>Color</em>, terms like <em>Red</em> or <em>Blue</em>.
                </p>
                <p>
                  Terms ensure consistency across your catalog and power filtering, search, and product variations. When you assign an attribute to a product, you’ll pick from these terms instead of typing free-form values.
                </p>
                <p>
                  In the table below, you can create, edit, or delete terms for the selected attribute. Click the <strong>+</strong> button to add a new term, then use these terms when editing products or building variations.
                </p>
              </>
            }
          />
        </div>
      </div>
      <TermTable attributeId={attributeId} />
    </div>
  );
}