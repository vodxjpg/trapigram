// src/app/(dashboard)/organizations/[identifier]/clients/page.tsx  ← keep path
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, KeyRound } from "lucide-react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";
import { Button } from "@/components/ui/button";
import { ClientsTable } from "./clients-table";
import { Switch } from "@/components/ui/switch";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
} from "@/components/ui/drawer";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";

/* -------------------------------------------------------------------------- */

export default function ClientsPage() {
  const router = useRouter();

  /* ── active organisation → id for permission hook ────────────────────── */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  /* ── secure permission checks ─────────────────────────────────────────── */
  const { hasPermission: viewPerm, isLoading: viewLoading } = useHasPermission(
    organizationId,
    { customer: ["view"] },
  );
  const { hasPermission: createPerm, isLoading: createLoading } = useHasPermission(
    organizationId,
    { customer: ["create"] },
  );
  const { hasPermission: updatePerm, isLoading: updateLoading } = useHasPermission(
    organizationId,
    { customer: ["update"] },
  );

  /* ── mirror legacy local state for minimal churn ─────────────────────── */
  const [mayView, setMayView] = useState<boolean | null>(null);

  useEffect(() => {
    if (!viewLoading) setMayView(viewPerm);
  }, [viewLoading, viewPerm]);

  /* ── guards ───────────────────────────────────────────────────────────── */
  if (mayView === null) return null; // still resolving
  if (!mayView) {
    router.replace("/dashboard");
    return null; // redirect
  }

  const canCreate = createPerm && !createLoading;
  const canForceAll = updatePerm && !updateLoading;

  /* ── Force-all Drawer state ───────────────────────────────────────────── */
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // form fields
  const [enableAll, setEnableAll] = useState(true);         // also enable for everyone
  const [reverifyDays, setReverifyDays] = useState<string>(""); // optional
  const [forceNow, setForceNow] = useState(true);
  const [forceAt, setForceAt] = useState<string>("");       // datetime-local ISO (no TZ)

  const resetForm = () => {
    setEnableAll(true);
    setReverifyDays("");
    setForceNow(true);
    setForceAt("");
  };

  const onApplyClicked = () => {
    // open confirmation dialog first
    setConfirmOpen(true);
  };

  const doSubmit = async () => {
    setSubmitting(true);
    try {
      const payload: any = { all: true };

      if (typeof enableAll === "boolean") payload.enabled = enableAll;

      if (reverifyDays.trim()) {
        const n = Number(reverifyDays);
        if (!Number.isFinite(n) || n < 1 || n > 365) {
          throw new Error("Re-verify days must be a number between 1 and 365.");
        }
        payload.reverifyAfterDays = n;
      }

      if (forceNow) {
        payload.forceNow = true;
      } else if (forceAt.trim()) {
        // convert local datetime to ISO; backend accepts ISO 8601
        payload.forceAt = new Date(forceAt).toISOString();
      } else {
        // If neither now nor schedule provided, still OK — just (re)enable / set days.
      }

      const res = await fetch("/api/clients/secret-phrase/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Failed to apply settings");
      }

      toast.success("Secret phrase has been forced for all clients.");
      setConfirmOpen(false);
      setDrawerOpen(false);
      resetForm();
    } catch (err: any) {
      toast.error(err?.message || "Failed to update settings");
    } finally {
      setSubmitting(false);
    }
  };

  /* ── page ─────────────────────────────────────────────────────────────── */
  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Clients</h1>
          <p className="text-muted-foreground">Manage your client database</p>
        </div>

        <div className="flex items-center gap-2">
          {canForceAll && (
            <Button variant="outline" onClick={() => setDrawerOpen(true)}>
              <KeyRound className="mr-2 h-4 w-4" />
              Force Secret Phrase
            </Button>
          )}
          {canCreate && (
            <Link href="/clients/new">
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Add New Client
              </Button>
            </Link>
          )}
        </div>
      </div>

      <ClientsTable />

      {/* Drawer: Force Secret Phrase for ALL clients */}
      <Drawer open={drawerOpen} onOpenChange={(o) => (o ? setDrawerOpen(true) : setDrawerOpen(false))}>
        <DrawerContent side="right">
          <DrawerHeader>
            <DrawerTitle>Force secret phrase for all clients</DrawerTitle>
            <DrawerDescription>
              Trigger a re-verification prompt for every client. You can apply it immediately or schedule it.
            </DrawerDescription>
          </DrawerHeader>

          <div className="px-5 py-4 space-y-6">
            {/* Enable for everyone */}
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-medium">Enable for all clients</div>
                <p className="text-sm text-muted-foreground">
                  If some clients have secret phrase disabled, turn it on globally.
                </p>
              </div>
              <Switch checked={enableAll} onCheckedChange={setEnableAll} />
            </div>

            {/* Re-verify after X days */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Re-verify after (days, optional)</label>
              <Input
                type="number"
                min={1}
                max={365}
                placeholder="e.g. 90"
                value={reverifyDays}
                onChange={(e) => setReverifyDays(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                If provided, clients will be asked again after this many days from their last setup.
              </p>
            </div>

            {/* Force mode */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Force now</label>
                <Switch checked={forceNow} onCheckedChange={setForceNow} />
              </div>
              {!forceNow && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Schedule (local time)</label>
                  <Input
                    type="datetime-local"
                    value={forceAt}
                    onChange={(e) => setForceAt(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Pick a date/time to enforce the challenge later. Leave empty to only change settings above.
                  </p>
                </div>
              )}
            </div>
          </div>

          <DrawerFooter className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setDrawerOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={onApplyClicked} disabled={submitting}>
              Review &amp; Apply
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Confirm dialog */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Force secret phrase for all clients?</AlertDialogTitle>
            <AlertDialogDescription>
              This action will prompt <b>all</b> clients to enter their secret phrase
              {forceNow ? " immediately." : forceAt ? ` at ${new Date(forceAt).toLocaleString()}.` : "."}
              <br />
              {enableAll && (
                <>
                  It will also <b>enable</b> the secret-phrase requirement for everyone.
                  <br />
                </>
              )}
              {reverifyDays && (
                <>
                  Re-verify interval will be set to <b>{reverifyDays} days</b>.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doSubmit} disabled={submitting}>
              {submitting ? "Applying…" : "Continue"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
