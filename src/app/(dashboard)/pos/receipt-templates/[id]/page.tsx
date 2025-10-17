"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { ArrowLeft, Upload, X } from "lucide-react";
import {
  Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
} from "@/components/ui/select";

type Template = {
  id: string;
  name: string;
  type: "receipt";
  printFormat: "thermal" | "a4";
  options: any;
  createdAt?: string;
  updatedAt?: string;
};

const FALLBACK: Template = {
  id: "",
  name: "",
  type: "receipt",
  printFormat: "thermal",
  options: {
    showLogo: true,
    logoUrl: null,
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
      showSku: false,
    },
  },
};

export default function ReceiptTemplateDetailPage() {
  const { id } = useParams() as { id: string };
  const [tpl, setTpl] = React.useState<Template>(FALLBACK);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  // local preview for logo (from tpl.options.logoUrl)
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/pos/receipt-templates/${id}`);
        if (!res.ok) throw new Error("Failed to load template");
        const j = await res.json();
        setTpl(j.template);
      } catch (e: any) {
        toast.error(e?.message || "Could not load template");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/pos/receipt-templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: tpl.name, printFormat: tpl.printFormat, options: tpl.options }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const j = await res.json();
      setTpl(j.template);
      toast.success("Template updated");
    } catch (e: any) {
      toast.error(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(file: File) {
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) throw new Error("Upload failed");
      const { filePath } = await res.json();
      setTpl((cur) => ({
        ...cur,
        options: { ...cur.options, logoUrl: filePath, showLogo: true },
      }));
      toast.success("Logo uploaded");
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    }
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) uploadLogo(f);
  };

  const onDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) uploadLogo(f);
  };

  if (loading) {
    return (
      <div className="container mx-auto py-6 px-6">
        <div className="h-8 w-48 bg-muted rounded animate-pulse" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href="/pos/receipt-templates">
            <Button variant="ghost" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{tpl.name || "Receipt Template"}</h1>
            <p className="text-muted-foreground">Edit template options and preview</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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

            {/* Logo controls */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center justify-between rounded-md border p-3 md:col-span-2">
                <div className="text-sm">
                  <div className="font-medium">Show company logo</div>
                  <div className="text-muted-foreground">Display the uploaded logo at the top of the receipt</div>
                </div>
                <Switch
                  checked={!!tpl.options.showLogo}
                  onCheckedChange={(v) => setTpl({ ...tpl, options: { ...tpl.options, showLogo: v } })}
                />
              </div>

              <div className="md:col-span-2">
                <Label>Logo image</Label>
                <label
                  htmlFor="logo-upload"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={onDrop}
                  className="group relative mt-1 flex h-40 items-center justify-center rounded-md border border-dashed hover:border-primary/70 hover:bg-muted/50 transition-colors cursor-pointer"
                >
                  {tpl.options.logoUrl ? (
                    <>
                      {/* Next/Image works with local /uploads paths */}
                      <Image
                        src={tpl.options.logoUrl}
                        alt="Company logo"
                        fill
                        className="object-contain p-4 rounded"
                      />
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        className="absolute top-2 right-2 h-7 w-7"
                        onClick={(e) => {
                          e.preventDefault();
                          setTpl((cur) => ({ ...cur, options: { ...cur.options, logoUrl: null } }));
                          if (fileInputRef.current) fileInputRef.current.value = "";
                        }}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </>
                  ) : (
                    <div className="flex flex-col items-center text-center">
                      <Upload className="h-8 w-8 text-muted-foreground group-hover:text-primary" />
                      <span className="mt-2 text-sm text-muted-foreground">
                        Click or drag an image here (PNG/JPG/WebP)
                      </span>
                    </div>
                  )}
                  <Input
                    id="logo-upload"
                    type="file"
                    accept="image/*"
                    ref={fileInputRef}
                    onChange={onFileChange}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                </label>
                {tpl.options.logoUrl && (
                  <p className="text-xs text-muted-foreground mt-1 break-all">{tpl.options.logoUrl}</p>
                )}
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

              {/* NEW: show SKU */}
              <div className="flex items-center justify-between rounded-md border p-3">
                <div className="text-sm">
                  <div className="font-medium">Show product SKU</div>
                  <div className="text-muted-foreground">Display SKU next to item titles</div>
                </div>
                <Switch
                  checked={!!tpl.options?.flags?.showSku}
                  onCheckedChange={(v) =>
                    setTpl({ ...tpl, options: { ...tpl.options, flags: { ...tpl.options.flags, showSku: v } } })
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
          </Card>
        </div>

        {/* Live preview */}
        <div className="space-y-2">
          <div className="text-sm text-muted-foreground">Preview</div>
          <div
            className={`receipt border rounded-md p-4 mx-auto bg-white ${
              tpl.printFormat === "thermal" ? "w-[80mm]" : "w-[650px]"
            }`}
          >
            {/* Logo & name */}
            {tpl.options.showLogo && tpl.options.logoUrl && (
              <div className="flex justify-center">
                {/* Keep the logo small; print styles force max-height too */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={tpl.options.logoUrl}
                  alt="Logo"
                  className="max-h-12 object-contain mb-1"
                />
              </div>
            )}
            {tpl.options.showCompanyName && (
              <div className="text-center font-semibold">Store</div>
            )}
            {!!tpl.options.headerText && (
              <div className="text-center text-[11px] text-muted-foreground mt-1">{tpl.options.headerText}</div>
            )}
            {tpl.options.showStoreAddress && (
              <div className="text-[10px] text-center text-muted-foreground mt-1">123 Main St, City</div>
            )}
            <hr className="my-2" />
            <div className="text-[10px] flex justify-between">
              <span>Date</span><span>{new Date().toLocaleString()}</span>
            </div>
            <div className="text-[10px] flex justify-between">
              <span>Receipt</span><span>pos-a7ae7cff8fdd</span>
            </div>
            <div className="text-[10px] flex justify-between">
              <span>Customer</span><span>Walk-in Customer</span>
            </div>
            {tpl.options.flags?.showCashier && (
              <div className="text-[10px] flex justify-between">
                <span>{tpl.options.labels?.servedBy || "Served by"}</span><span>Alex</span>
              </div>
            )}
            <hr className="my-2" />

            <div className="text-[11px] font-medium">
              {tpl.options.labels?.item ?? "Item"}&nbsp;&nbsp;/&nbsp;&nbsp;{tpl.options.labels?.price ?? "Price"}
            </div>
            {/* Sample lines (SKU shown when enabled) */}
            <div className="text-[10px] flex justify-between">
              <span>
                1 × Variable product
                {tpl.options.flags?.showSku && <span className="text-muted-foreground"> (SKU: ORG-f291ce3b)</span>}
              </span>
              <span>$50.00</span>
            </div>

            <hr className="my-2" />
            <div className="text-[10px] flex justify-between"><span>{tpl.options.labels?.subtotal ?? "Subtotal"}</span><span>$50.00</span></div>
            <div className="text-[10px] flex justify-between"><span>{tpl.options.labels?.tax ?? "Tax"}</span><span>$0.00</span></div>
            <div className="text-[12px] flex justify-between font-semibold mt-1">
              <span>{tpl.options.labels?.total ?? "Total"}</span><span>$50.00</span>
            </div>

            <hr className="my-2" />
            <div className="text-[11px] font-medium">Payments</div>
            <div className="text-[10px] flex justify-between"><span>Card</span><span>$50.00</span></div>
          </div>

          {/* Print sizing overrides */}
          <style jsx global>{`
            @media print {
              @page { size: auto; margin: 0 }
              .receipt {
                width: 80mm !important;      /* force POS roll width */
                font-size: 11px !important;  /* sane base size for thermal */
                line-height: 1.25 !important;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
              }
              .receipt img { max-height: 38px !important; }
            }
          `}</style>
        </div>
      </div>
    </div>
  );
}
