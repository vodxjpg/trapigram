"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
} from "@/components/ui/drawer";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";

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
  method: PaymentMethod | null;
}

export function PaymentMethodDrawer({ open, onClose, method }: Props) {
  const [name, setName] = useState("");
  const [active, setActive] = useState(true);
  const [apiKey, setApiKey] = useState<string>("");
  const [secretKey, setSecretKey] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const isMobile = useIsMobile();

  // preload on edit
  useEffect(() => {
    if (method) {
      setName(method.name);
      setActive(method.active);
      setApiKey(method.apiKey ?? "");
      setSecretKey(method.secretKey ?? "");
    } else {
      setName("");
      setActive(true);
      setApiKey("");
      setSecretKey("");
    }
  }, [method]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name,
        active,
        apiKey: apiKey.trim() || null,
        secretKey: secretKey.trim() || null,
      };

      let res: Response;
      if (method) {
        // edit
        res = await fetch(`/api/payment-methods/${method.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        // create
        res = await fetch(`/api/payment-methods`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      setName("");
      setActive(true);
      setApiKey("");
      setSecretKey("");

      onClose(true);
      if (!res.ok) throw new Error();
      toast.success(method ? "Updated" : "Created");
      onClose(true);
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => !o && onClose()}
      direction={isMobile ? "bottom" : "right"}
    >
      <DrawerContent side="right">
        <DrawerHeader>
          <DrawerTitle>
            {method ? "Edit Payment Method" : "New Payment Method"}
          </DrawerTitle>
          <DrawerDescription>
            {method
              ? "Update the fields of this payment method."
              : "Add a new payment method and set its active status."}
          </DrawerDescription>
        </DrawerHeader>

        <div className="px-4 space-y-4">
          {/* Name */}
          <Input
            placeholder="Payment name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full"
            disabled={saving}
          />

          {/* Active Switch */}
          <div className="flex items-center space-x-2">
            <Switch
              checked={active}
              onCheckedChange={setActive}
              disabled={saving}
            />
            <span>{active ? "Active" : "Inactive"}</span>
          </div>

          {/* API Key */}
          <Input
            placeholder="API Key (optional)"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="w-full"
            disabled={saving}
          />

          {/* Secret Key */}
          <Input
            placeholder="Secret Key (optional)"
            value={secretKey}
            onChange={(e) => setSecretKey(e.target.value)}
            className="w-full"
            disabled={saving}
          />
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
