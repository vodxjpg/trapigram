// src/app/(dashboard)/notification-templates/page.tsx
"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense } from "react";
import { Info, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useHeaderTitle } from "@/context/HeaderTitleContext";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";
import { NotificationTemplatesTable } from "./components/notification-templates-table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export default function NotificationTemplatesPage() {
  const router = useRouter();
  const { setHeaderTitle } = useHeaderTitle();

  /* ── active organisation ───────────────────────────────────────────── */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const orgId = activeOrg?.id ?? null;

  /* ── permissions ───────────────────────────────────────────────────── */
  const {
    hasPermission: canView,
    isLoading: permLoading,
  } = useHasPermission(orgId, { notifications: ["view"] });

  const { hasPermission: canCreate } = useHasPermission(orgId, {
    notifications: ["create"],
  });

  useEffect(() => {
    setHeaderTitle("Notification Templates");
  }, [setHeaderTitle]);

  useEffect(() => {
    if (!permLoading && !canView) {
      router.replace("/dashboard");
    }
  }, [permLoading, canView, router]);

  if (permLoading) return null;

  if (!canView) {
    return (
      <div className="container mx-auto py-6 px-6 text-center text-red-600">
        You don’t have permission to view notification templates.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">
            Notification Templates
          </h1>

          {/* Shortened helper with tooltip + dialog for “learn more” */}
          <div className="flex items-center gap-2 text-muted-foreground">
            <p>Create and manage e-mail / in-app template bodies</p>

            <Dialog>
              <TooltipProvider>
                <Tooltip>
                  <DialogTrigger asChild>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Learn how to use Telegram groups"
                        className="h-6 w-6 p-0"
                      >
                        <Info className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                  </DialogTrigger>
                  <TooltipContent>
                    <p>How to use Telegram notification groups</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Telegram notification groups</DialogTitle>
                  <DialogDescription asChild>
                    <div className="space-y-3">
                      <p>
                        To make the bot send notifications for a specific
                        country into a Telegram group, invite your bot to the
                        group and send:
                      </p>
                      <pre className="rounded-md bg-muted p-3 text-sm">
                        /notification_group COUNTRY_CODE
                      </pre>
                      <p className="text-sm text-muted-foreground">
                        Example: <code>/notification_group IT</code> to receive
                        Italian notifications in that group.
                      </p>
                      <p className="text-sm text-muted-foreground">
                        You can configure template bodies per role (admin/user)
                        and optionally scope them by country. If no country is
                        set on a template, it’s considered global.
                      </p>
                    </div>
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button type="button">Got it</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {canCreate && (
          <Button asChild>
            <Link href="/notification-templates/new">
              <Plus className="mr-2 h-4 w-4" />
              New Template
            </Link>
          </Button>
        )}
      </div>

      <Suspense fallback={<div>Loading templates…</div>}>
        <NotificationTemplatesTable />
      </Suspense>
    </div>
  );
}
