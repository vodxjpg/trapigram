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
  mode: "coinx" | "custom";
  method: PaymentMethod | null;
}

/* ---------- component ---------- */
export function PaymentMethodDrawer({
  open,
  onClose,
  mode,
  method,
}: Props) {
  const isCoinx = mode === "coinx";

  /* form state */
  const [name, setName] = useState(isCoinx ? "CoinX" : "");
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
      setName(isCoinx ? "CoinX" : "");
      setActive(true);
      setApiKey("");
      setSecretKey("");
    }
  }, [method, mode]);

  /* ---------- save ---------- */
  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: isCoinx ? "CoinX" : name.trim(),
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
              ? isCoinx
                ? "Configure CoinX"
                : "Edit payment method"
              : isCoinx
              ? "Configure CoinX"
              : "New payment method"}
          </DrawerTitle>
          <DrawerDescription>
            {isCoinx
              ? "Enter your CoinX credentials."
              : "Fill in the details of the payment method."}
          </DrawerDescription>
        </DrawerHeader>

        <div className="px-4 space-y-4">
          {/* name (hidden/locked for CoinX) */}
          {!isCoinx && (
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

          {/* API key */}
          <div>
            <label className="block text-sm font-medium mb-1">API key</label>
            <Input
              placeholder="Optional"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              disabled={saving}
            />
          </div>

          {/* secret key */}
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
