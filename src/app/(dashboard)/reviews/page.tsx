"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ReviewsTable } from "./components/review-table";
import { useHeaderTitle } from "@/context/HeaderTitleContext";
import { useHasPermission } from "@/hooks/use-has-permission";
import { authClient } from "@/lib/auth-client";

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
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Reviews</h1>
        <p className="text-muted-foreground">
          Manage your Reviews.
        </p>
      </div>
      <ReviewsTable />
    </div>
  );
}