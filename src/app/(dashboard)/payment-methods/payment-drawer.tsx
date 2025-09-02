// /home/zodx/Desktop/trapigram/src/app/(dashboard)/payment-methods/payment-drawer.tsx
"use client";

import React, { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";

/* ---------- types ---------- */
export interface PaymentMethod {
  id: string;
  name: string;
  active: boolean;
  apiKey?: string | null;
  secretKey?: string | null;
}

interface Props {
  open: boolean;
  onClose: (refresh?: boolean) => void;
  mode: "niftipay" | "custom";
  method: PaymentMethod | null;
}

/* ---------- component ---------- */
export function PaymentMethodDrawer({
  open,
  onClose,
  mode,
  method,
}: Props) {
  const isNiftipay = mode === "niftipay";

  /* form state */
  const [name, setName] = useState(isNiftipay ? "Niftipay" : "");
  const [active, setActive] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [saving, setSaving] = useState(false);
  const isMobile = useIsMobile();

  /* preload when editing */
  useEffect(() => {
    if (method) {
      setName(method.name);
      setActive(method.active);
      setApiKey(method.apiKey ?? "");
      setSecretKey(method.secretKey ?? "");
    } else {
      setName(isNiftipay ? "Niftipay" : "");
      setActive(true);
      setApiKey("");
      setSecretKey("");
    }
  }, [method, mode, isNiftipay]);

  /* ---------- Easy Connect (Niftipay) ---------- */
  const handleConnectNiftipay = async () => {
    setSaving(true);
    try {
      // Body is optional; server resolves email from session if not provided.
      const res = await fetch("/api/niftipay/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      // Try to surface upstream error details
      if (!res.ok) {
        let message = "Failed to connect Niftipay";
        try {
          const data = await res.json();
          if (typeof data?.error === "string") message = data.error;
        } catch {
          /* ignore parse error */
        }
        throw new Error(message);
      }

      // On success, the API already upserts/activates the Niftipay method.
      toast.success("Niftipay connected successfully");

      // Notify the page to show a verification dialog (5s lockout).
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("niftipay-connected"));
      }
      onClose(true); // refresh table
    } catch (err: any) {
      toast.error(err?.message || "Niftipay connect failed");
    } finally {
      setSaving(false);
    }
  };

  /* ---------- manual save (custom / advanced) ---------- */
  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: isNiftipay ? "Niftipay" : name.trim(),
        active,
        apiKey: apiKey.trim() || null,
        secretKey: secretKey.trim() || null,
      };

      const res = await fetch(
        method ? `/api/payment-methods/${method.id}` : "/api/payment-methods",
        {
          method: method ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) throw new Error();
      toast.success(method ? "Updated" : "Created");
      onClose(true);
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  /* ---------- render ---------- */
  return (
    <Drawer
      open={open}
      onOpenChange={(o) => !o && onClose()}
      direction={isMobile ? "bottom" : "right"}
    >
      <DrawerContent side="right">
        <DrawerHeader>
          <DrawerTitle>
            {method
              ? isNiftipay
                ? "Configure Niftipay"
                : "Edit payment method"
              : isNiftipay
              ? "Configure Niftipay"
              : "New payment method"}
          </DrawerTitle>
          <DrawerDescription>
            {isNiftipay
              ? "Use Easy Connect to automatically create/link your Niftipay account and generate an API key, or paste an existing key below."
              : "Fill in the details of the payment method."}
          </DrawerDescription>
        </DrawerHeader>

        <div className="px-4 space-y-4">
          {/* ───────── Easy Connect CTA (Niftipay only) ───────── */}
          {isNiftipay && (
            <div className="rounded-lg border p-4">
              <div className="mb-2 font-medium">Niftipay Easy Connect</div>
              <p className="text-sm text-muted-foreground mb-3">
                We’ll securely create/link your Niftipay account and store the API key for this
                tenant. No copy-paste required.
              </p>
              <Button onClick={handleConnectNiftipay} disabled={saving}>
                {saving ? "Connecting…" : "Connect Niftipay"}
              </Button>
            </div>
          )}

          {/* name (hidden/locked for Niftipay) */}
          {!isNiftipay && (
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <Input
                placeholder="Payment name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={saving}
              />
            </div>
          )}

          {/* active */}
          <div>
            <label className="block text-sm font-medium mb-1">Active</label>
            <div className="flex items-center space-x-2">
              <Switch
                checked={active}
                onCheckedChange={setActive}
                disabled={saving}
              />
              <span>{active ? "Active" : "Inactive"}</span>
            </div>
          </div>

          {/* API key (optional manual entry / view) */}
          <div>
            <label className="block text-sm font-medium mb-1">API key</label>
            <Input
              placeholder={isNiftipay ? "Filled automatically by Easy Connect (optional override)" : "Optional"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              disabled={saving}
            />
          </div>

          {/* secret key (only for custom methods) */}
          {!isNiftipay && (
            <div>
              <label className="block text-sm font-medium mb-1">
                Secret key
              </label>
              <Input
                placeholder="Optional"
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                disabled={saving}
              />
            </div>
          )}
        </div>

        <DrawerFooter className="space-x-2">
          <Button variant="outline" onClick={() => onClose()} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
