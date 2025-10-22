// src/app/(dashboard)/tickets/page.tsx
"use client";

import { useEffect, useMemo } from "react";
import { Suspense } from "react";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";
import { useHeaderTitle } from "@/context/HeaderTitleContext";
import { TicketsTable } from "./components/ticket-table";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

export default function TicketsPage() {
  const router = useRouter();
  const { setHeaderTitle } = useHeaderTitle();

  /* ---------- permissions ------------------------------------------------ */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  const { hasPermission: viewPerm, isLoading: viewLoading } =
    useHasPermission(organizationId, { ticket: ["view"] });

  /* ---------- derived flag (always computed) ----------------------------- */
  const canView = useMemo(
    () => !viewLoading && viewPerm,
    [viewLoading, viewPerm],
  );

  /* ---------- side-effects (always run) ---------------------------------- */
  useEffect(() => {
    setHeaderTitle("Tickets");
    if (!viewLoading && !viewPerm) router.replace("/dashboard");
  }, [setHeaderTitle, viewLoading, viewPerm, router]);

  /* ---------- guards AFTER all hooks ------------------------------------ */
  if (viewLoading || !canView) return null;

  /* ---------- UI --------------------------------------------------------- */
  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Tickets</h1>

          {/* Shortened helper with tooltip + dialog for “learn more” (Telegram groups) */}
          <div className="flex items-center gap-2 text-muted-foreground">
            <p>Manage your customer support tickets</p>

            <Dialog>
              <TooltipProvider>
                <Tooltip>
                  <DialogTrigger asChild>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Learn how to use Telegram ticket groups"
                        className="h-6 w-6 p-0"
                      >
                        <Info className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                  </DialogTrigger>
                  <TooltipContent>
                    <p>How to use Telegram ticket groups</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Telegram ticket groups</DialogTitle>
                  <DialogDescription asChild>
                    <div className="space-y-3">
                      <p>
                        To receive ticket notifications for a specific country in a Telegram group,
                        invite your bot to the group and send:
                      </p>
                      <pre className="rounded-md bg-muted p-3 text-sm">
                        /ticketing_group add COUNTRY_CODE
                      </pre>
                      <p className="text-sm text-muted-foreground">
                        Example: <code>/ticketing_group add IT</code> to receive Italian ticket notifications.
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Templates can be scoped by role (admin/user) and by country. If no country is set,
                        the template is considered global.
                      </p>
                    </div>
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button type="button">Got it</Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      <Suspense fallback={<div>Loading ticket table…</div>}>
        <TicketsTable />
      </Suspense>
    </div>
  );
}
