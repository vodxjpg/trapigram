"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ReviewsTable } from "./components/review-table";
import { useHasPermission } from "@/hooks/use-has-permission";
import { authClient } from "@/lib/auth-client";

// Reusable info tooltip + dialog component
import InfoHelpDialog from "@/components/dashboard/info-help-dialog";
import { PageHeader } from "@/components/page-header";
import { useHeaderTitle } from "@/context/HeaderTitleContext"

export default function ReviewsPage() {
  const { setHeaderTitle } = useHeaderTitle();
  const router = useRouter();

  // scope permission to active org
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  const {
    hasPermission: canViewReviews,
    isLoading: permLoading,
  } = useHasPermission(organizationId, { reviews: ["view"] });

  useEffect(() => {
    setHeaderTitle("Reviews"); // Set the header title for this page
  }, [setHeaderTitle]);

  useEffect(() => {
    if (!permLoading && !canViewReviews) {
      router.replace("/dashboard");
    }
  }, [permLoading, canViewReviews, router]);

  if (permLoading || !canViewReviews) return null; // waiting / redirecting


  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div>
            <PageHeader
              title="Reviews"
              description="Manage your Reviews." />
          </div>
          {/* Use InfoHelpDialog with the new `content` prop */}
          <InfoHelpDialog
            title="About reviews"
            tooltip="What are reviews?"
            content={
              <>
                <p>
                  <strong>Reviews</strong> are customer feedback and ratings left for your products or services. They help build trust, improve your brand reputation, and provide insights into customer satisfaction.
                </p>
                <p>
                  Managing reviews allows you to monitor feedback, respond to customers, highlight positive experiences, and address issues that may impact your business. Reviews can also influence purchasing decisions and boost conversions.
                </p>
                <p>
                  In the table below, you can view, approve, or moderate reviews. Use these tools to maintain quality feedback and ensure your platform reflects authentic customer experiences.
                </p>
              </>
            }
          />
        </div>
      </div>
      <ReviewsTable />
    </div>
  );
}