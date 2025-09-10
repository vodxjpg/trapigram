// src/app/(dashboard)/payment-methods/payment-drawer.tsx
"use client";

import React, { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
  description?: string | null;
  instructions?: string | null;
  default?: boolean;
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
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [saving, setSaving] = useState(false);
  const isMobile = useIsMobile();

  /* preload when editing */
  useEffect(() => {
    if (method) {
      setName(method.name);
      setActive(method.active);
      setApiKey(method.apiKey ?? "");
      setSecretKey(method.secretKey ?? "");
      setDescription(method.description ?? "");
      setInstructions(method.instructions ?? "");
    } else {
      setName(isNiftipay ? "Niftipay" : "");
      setActive(true);
      setApiKey("");
      setSecretKey("");
      setDescription("");
      setInstructions("");
    }
  }, [method, mode, isNiftipay]);

  /* ---------- Easy Connect (Niftipay) ---------- */
  const handleConnectNiftipay = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/niftipay/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        let message = "Failed to connect Niftipay";
        try {
          const data = await res.json();
          if (typeof data?.error === "string") message = data.error;
        } catch {}
        throw new Error(message);
      }

      toast.success("Niftipay connected successfully");

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
    if (!name.trim() && !isNiftipay) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, any> = {
        name: isNiftipay ? "Niftipay" : name.trim(),
        active,
        apiKey: apiKey.trim() || null,
        // Secret key stays editable only for custom methods
        ...(isNiftipay ? {} : { secretKey: secretKey.trim() || null }),
        description: description.trim() || null,
        instructions: instructions.trim() || null,
      };

      const res = await fetch(
        method ? `/api/payment-methods/${method.id}` : "/api/payment-methods",
        {
          method: method ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || "Failed to save");
      }
      toast.success(method ? "Updated" : "Created");
      onClose(true);
    } catch (e: any) {
      toast.error(e?.message || "Failed to save");
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
          {/* Easy Connect CTA (Niftipay only) */}
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

          {/* secret key (custom methods only) */}
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

          {/* description */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Description
            </label>
            <Textarea
              placeholder="Short text shown to admins to explain this method (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-[80px]"
              disabled={saving}
            />
          </div>

          {/* instructions */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Instructions for customers
            </label>
            <Textarea
              placeholder="What customers should do after choosing this method (e.g., bank transfer reference, etc.)"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              className="min-h-[120px]"
              disabled={saving}
            />
          </div>
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
