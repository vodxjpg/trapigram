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
}

interface Props {
  open: boolean;
  onClose: (refresh?: boolean) => void;
  method: PaymentMethod | null;
}

export function PaymentMethodDrawer({ open, onClose, method }: Props) {
  const [name, setName] = useState("");
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const isMobile = useIsMobile();

  // preload on edit
  useEffect(() => {
    if (method) {
      setName(method.name);
      setActive(method.active);
    } else {
      setName("");
      setActive(true);
    }
  }, [method]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    try {
      let res: Response;
      const payload = JSON.stringify({ name, active });
      if (method) {
        // edit
        res = await fetch(`/api/payment-methods/${method.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: payload,
        });
      } else {
        // create
        res = await fetch(`/api/payment-methods`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
        });
      }
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
              ? "Update the name and status of this payment method."
              : "Add a new payment method and set its active status."}
          </DrawerDescription>
        </DrawerHeader>

        <div className="px-4 space-y-4">
          <Input
            placeholder="Payment name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full"
            disabled={saving}
          />

          {/* ← NEW Active switch */}
          <div className="flex items-center space-x-2">
            <Switch
              checked={active}
              onCheckedChange={setActive}
              disabled={saving}
            />
            <span>{active ? "Active" : "Inactive"}</span>
          </div>
        </div>

        <DrawerFooter className="space-x-2">
          <Button
            variant="outline"
            onClick={() => onClose()}
            disabled={saving}
          >
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
