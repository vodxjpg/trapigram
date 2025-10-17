"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

type Template = {
  id?: string;
  name: string;
  type: "receipt";
  printFormat: "thermal" | "a4";
  options: any;
};

const DEFAULT_TPL: Template = {
  name: "Default Template",
  type: "receipt",
  printFormat: "thermal",
  options: {
    showLogo: false,
    showCompanyName: true,
    headerText: "",
    showStoreAddress: true,
    showCustomerAddress: false,
    showCustomerDetailsTitle: false,
    displayCompanyFirst: false,
    labels: {
      item: "Item",
      price: "Price",
      subtotal: "Subtotal",
      discount: "Discount",
      tax: "Tax",
      total: "Total",
      change: "Change",
      outstanding: "Outstanding",
      servedBy: "Served by",
    },
    flags: {
      hideDiscountIfZero: true,
      printBarcode: true,
      showOrderKey: true,
      showCashier: true,
    },
  },
};

export default function ReceiptTemplatesPage() {
  const [tpl, setTpl] = React.useState<Template>(DEFAULT_TPL);
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/pos/receipt-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tpl),
      });
      if (!res.ok) throw new Error("Failed to save");
      const j = await res.json();
      setTpl(j.template);
      toast.success("Template saved");
    } catch (e: any) {
      toast.error(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Editor */}
      <div className="space-y-4">
        <Card className="p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label>Name</Label>
              <Input
                value={tpl.name}
                onChange={(e) => setTpl({ ...tpl, name: e.target.value })}
                placeholder="Default Template"
              />
            </div>
            <div>
              <Label>Print format</Label>
              <Select
                value={tpl.printFormat}
                onValueChange={(v: "thermal" | "a4") => setTpl({ ...tpl, printFormat: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="thermal">Thermal (POS)</SelectItem>
                  <SelectItem value="a4">A4</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Header text</Label>
              <Input
                value={tpl.options.headerText ?? ""}
                onChange={(e) => setTpl({ ...tpl, options: { ...tpl.options, headerText: e.target.value } })}
                placeholder="Thanks for your purchase!"
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="text-sm">
                <div className="font-medium">Show company name</div>
                <div className="text-muted-foreground">Display company/store name on top</div>
              </div>
              <Switch
                checked={!!tpl.options.showCompanyName}
                onCheckedChange={(v) => setTpl({ ...tpl, options: { ...tpl.options, showCompanyName: v } })}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="text-sm">
                <div className="font-medium">Show store address</div>
                <div className="text-muted-foreground">Print store address under header</div>
              </div>
              <Switch
                checked={!!tpl.options.showStoreAddress}
                onCheckedChange={(v) => setTpl({ ...tpl, options: { ...tpl.options, showStoreAddress: v } })}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="text-sm">
                <div className="font-medium">Show cashier</div>
                <div className="text-muted-foreground">Include the employee who served the customer</div>
              </div>
              <Switch
                checked={!!tpl.options?.flags?.showCashier}
                onCheckedChange={(v) =>
                  setTpl({ ...tpl, options: { ...tpl.options, flags: { ...tpl.options.flags, showCashier: v } } })
                }
              />
            </div>
          </div>

          <Separator />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(["item","price","subtotal","discount","tax","total","change","servedBy"] as const).map((k) => (
              <div key={k}>
                <Label className="capitalize">{k}</Label>
                <Input
                  value={tpl.options.labels?.[k] ?? ""}
                  onChange={(e) =>
                    setTpl({
                      ...tpl,
                      options: { ...tpl.options, labels: { ...tpl.options.labels, [k]: e.target.value } },
                    })
                  }
                />
              </div>
            ))}
          </div>

          <div className="flex justify-end">
            <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save template"}</Button>
          </div>
        </Card>
      </div>

      {/* Live preview (HTML) */}
      <div className="space-y-2">
        <div className="text-sm text-muted-foreground">Preview</div>
        <div
          className={`bg-white border rounded-md p-4 mx-auto ${
            tpl.printFormat === "thermal" ? "w-[80mm]" : "w-[650px]"
          }`}
        >
          {tpl.options.showCompanyName && <div className="text-center font-semibold">My Store</div>}
          {!!tpl.options.headerText && (
            <div className="text-center text-sm text-muted-foreground mt-1">{tpl.options.headerText}</div>
          )}
          <div className="text-xs text-center text-muted-foreground mt-1">123 Main St, City</div>
          <hr className="my-2" />
          <div className="text-xs flex justify-between">
            <span>Date</span><span>{new Date().toLocaleString()}</span>
          </div>
          <div className="text-xs flex justify-between">
            <span>Receipt</span><span>000123</span>
          </div>
          <div className="text-xs flex justify-between">
            <span>Customer</span><span>Walk-in</span>
          </div>
          {tpl.options.flags.showCashier && (
            <div className="text-xs flex justify-between">
              <span>{tpl.options.labels.servedBy || "Served by"}</span><span>Alex</span>
            </div>
          )}
          <hr className="my-2" />
          <div className="text-xs font-medium">{tpl.options.labels.item} / {tpl.options.labels.price}</div>
          <div className="text-xs flex justify-between"><span>1 × Demo T-shirt</span><span>$20.00</span></div>
          <div className="text-xs flex justify-between"><span>2 × Demo Jacket</span><span>$160.00</span></div>
          <hr className="my-2" />
          <div className="text-xs flex justify-between"><span>{tpl.options.labels.subtotal}</span><span>$180.00</span></div>
          <div className="text-xs flex justify-between"><span>{tpl.options.labels.discount}</span><span>-$10.00</span></div>
          <div className="text-xs flex justify-between"><span>{tpl.options.labels.tax}</span><span>$18.00</span></div>
          <div className="text-sm flex justify-between font-semibold mt-1">
            <span>{tpl.options.labels.total}</span><span>$188.00</span>
          </div>
        </div>
      </div>
    </div>
  );
}
