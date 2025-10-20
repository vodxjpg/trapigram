"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

type Props = { registerId: string };

export default function CustomerDisplayStatus({ registerId }: Props) {
  const [code, setCode] = React.useState<string | null>(null);
  const [portalUrl, setPortalUrl] = React.useState<string | null>(null);
  const [expiresAt, setExpiresAt] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  async function gen() {
    setLoading(true);
    try {
      const r = await fetch(`/api/pos/registers/${registerId}/customer-display/code`, { method: "POST" });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      setCode(j.code);
      setPortalUrl(j.portalUrl);
      setExpiresAt(j.expiresAt);
      toast.success("Pairing code generated");
    } catch (e: any) {
      toast.error(e.message || "Failed to generate code");
    } finally {
      setLoading(false);
    }
  }

  async function unpair() {
    await fetch(`/api/pos/registers/${registerId}/customer-display/unpair`, { method: "POST" });
    setCode(null); setExpiresAt(null);
    toast.success("Customer display unpaired");
  }

  return (
    <Card className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-medium">Customer Display</div>
        <div className="text-xs text-muted-foreground">
          {expiresAt ? `Code expires ${new Date(expiresAt).toLocaleTimeString()}` : "Not paired"}
        </div>
      </div>
      <Separator />
      <div className="flex items-center gap-2">
        <Button onClick={gen} disabled={loading}>Generate code</Button>
        <Button variant="outline" onClick={unpair}>Unpair</Button>
      </div>
      {code && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-center">
          <div className="md:col-span-2">
            <Label>6-digit pairing code</Label>
            <Input readOnly value={code} className="text-2xl tracking-widest text-center font-mono" />
            {portalUrl && (
              <p className="text-xs mt-1">
                Open customer screen at:&nbsp;
                <a className="underline" href={portalUrl} target="_blank" rel="noreferrer">{portalUrl}</a>
              </p>
            )}
          </div>
          {/* Optional quick QR using a public image API (swap for local lib if you prefer) */}
          {portalUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt="Portal QR"
              className="mx-auto h-32 w-32"
              src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(portalUrl)}`}
            />
          )}
        </div>
      )}
    </Card>
  );
}
