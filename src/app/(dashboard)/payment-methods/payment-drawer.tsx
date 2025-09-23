// src/app/(dashboard)/payment-methods/payment-drawer.tsx
"use client";

import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import "react-quill-new/dist/quill.snow.css";
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
  method: PaymentMethod | null;
}

/* ---------- ReactQuill (SSR-safe) ---------- */
const ReactQuill = dynamic(() => import("react-quill-new"), { ssr: false });

const quillModules = {
  toolbar: [
    [{ header: [1, 2, false] }],
    ["bold", "italic", "underline", "strike", "blockquote"],
    [
      { list: "ordered" },
      { list: "bullet" },
      { indent: "-1" },
      { indent: "+1" },
    ],
    ["link", "image"],
    ["clean"],
  ],
};

const quillFormats = [
  "header",
  "bold",
  "italic",
  "underline",
  "strike",
  "blockquote",
  "list",
  "indent",
  "link",
  "image",
];

/* ---------- component ---------- */
export function PaymentMethodDrawer({
  open,
  onClose,
  method,
}: Props) {
  /* form state */
  const [name, setName] = useState("");
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
      setName("");
      setActive(true);
      setApiKey("");
      setSecretKey("");
      setDescription("");
      setInstructions("");
    }
  }, [method]);

  /* ---------- save ---------- */
  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, any> = {
        name: name.trim(),
        active,
        apiKey: apiKey.trim() || null,
        secretKey: secretKey.trim() || null,
        description: description.trim() || null,
        // Instructions may be HTML produced by Quill – do not trim to avoid breaking tags
        instructions: instructions && instructions.length ? instructions : null,
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
    {/* give the content a tall, flex column layout */}
    <DrawerContent
      side="right"
      className={isMobile ? "h-[85vh]" : "h-[90vh]"}
    >
      {/* fixed header */}
      <DrawerHeader className="shrink-0">
        <DrawerTitle>
          {method ? "Edit payment method" : "New payment method"}
        </DrawerTitle>
        <DrawerDescription>
          Fill in the details of the payment method.
        </DrawerDescription>
      </DrawerHeader>

      {/* SCROLLABLE BODY */}
      <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-4">
        {/* name */}
        <div>
          <label className="block text-sm font-medium mb-1">Name</label>
          <Input
            placeholder="Payment name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={saving}
          />
        </div>

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
          <label className="block text-sm font-medium mb-1">Secret key</label>
          <Input
            placeholder="Optional"
            value={secretKey}
            onChange={(e) => setSecretKey(e.target.value)}
            disabled={saving}
          />
        </div>

        {/* description */}
        <div>
          <label className="block text-sm font-medium mb-1">Description</label>
          <Textarea
            placeholder="Short text shown to admins to explain this method (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="min-h-[80px]"
            disabled={saving}
          />
        </div>

        {/* instructions – ReactQuill */}
        <div>
          <label className="block text-sm font-medium mb-1">
            Instructions for customers (supports HTML)
          </label>
          <div className="border rounded-md">
            <ReactQuill
              theme="snow"
              modules={quillModules}
              formats={quillFormats}
              value={instructions || ""}
              onChange={setInstructions}
              // keep editor height reasonable so the body still scrolls
              className="min-h-[240px]"
            />
          </div>
        </div>
      </div>

      {/* fixed footer */}
      <DrawerFooter className="shrink-0 space-x-2">
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
