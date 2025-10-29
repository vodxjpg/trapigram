// /src/app/(dashboard)/conditional-rules/components/ActionsMulti.tsx
"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import ChannelsPicker, { Channel } from "./ChannelPicker";
import { Checkbox } from "@/components/ui/checkbox";

export type CouponConfig = {
  enabled: boolean;
  channels: Channel[];
  couponId?: string | null;
  code?: string;
  templateSubject?: string;
  templateMessage?: string;
  url?: string | null;
};

export type RecoConfig = {
  enabled: boolean;
  channels: Channel[];
  productIds?: string[];
  collectionId?: string;
  templateSubject?: string;
  templateMessage?: string;
  url?: string | null;
};

export default function ActionsMulti({
  coupon,
  setCoupon,
  reco,
  setReco,
  disabled,
}: {
  coupon: CouponConfig;
  setCoupon: (c: CouponConfig) => void;
  reco: RecoConfig;
  setReco: (c: RecoConfig) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-6">
      {/* Send coupon */}
      <div className="rounded-2xl border p-4 md:p-6 space-y-4">
        <label className="flex items-center gap-2">
          <Checkbox
            checked={coupon.enabled}
            onCheckedChange={(v) => setCoupon({ ...coupon, enabled: Boolean(v) })}
            disabled={disabled}
          />
          <span className="font-medium">Send coupon</span>
        </label>

        {coupon.enabled && (
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Channels</Label>
              <ChannelsPicker
                value={coupon.channels}
                onChange={(v) => setCoupon({ ...coupon, channels: v })}
                disabled={disabled}
              />
            </div>
            <div className="space-y-2">
              <Label>Coupon ID</Label>
              <Input
                value={coupon.couponId ?? ""}
                onChange={(e) => setCoupon({ ...coupon, couponId: e.target.value })}
                disabled={disabled}
              />
            </div>
            <div className="space-y-2">
              <Label>Fallback Code</Label>
              <Input
                value={coupon.code ?? ""}
                onChange={(e) => setCoupon({ ...coupon, code: e.target.value })}
                disabled={disabled}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Subject</Label>
              <Input
                value={coupon.templateSubject ?? ""}
                onChange={(e) => setCoupon({ ...coupon, templateSubject: e.target.value })}
                disabled={disabled}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Message (HTML allowed)</Label>
              <Textarea
                rows={4}
                value={coupon.templateMessage ?? ""}
                onChange={(e) => setCoupon({ ...coupon, templateMessage: e.target.value })}
                disabled={disabled}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>URL (optional)</Label>
              <Input
                value={coupon.url ?? ""}
                onChange={(e) => setCoupon({ ...coupon, url: e.target.value })}
                disabled={disabled}
              />
            </div>
          </div>
        )}
      </div>

      {/* Recommend product */}
      <div className="rounded-2xl border p-4 md:p-6 space-y-4">
        <label className="flex items-center gap-2">
          <Checkbox
            checked={reco.enabled}
            onCheckedChange={(v) => setReco({ ...reco, enabled: Boolean(v) })}
            disabled={disabled}
          />
          <span className="font-medium">Recommend product</span>
        </label>

        {reco.enabled && (
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Channels</Label>
              <ChannelsPicker
                value={reco.channels}
                onChange={(v) => setReco({ ...reco, channels: v })}
                disabled={disabled}
              />
            </div>
            <div className="space-y-2">
              <Label>Product IDs (comma)</Label>
              <Input
                value={(reco.productIds ?? []).join(",")}
                onChange={(e) =>
                  setReco({
                    ...reco,
                    productIds: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                disabled={disabled}
              />
            </div>
            <div className="space-y-2">
              <Label>Collection ID (optional)</Label>
              <Input
                value={reco.collectionId ?? ""}
                onChange={(e) => setReco({ ...reco, collectionId: e.target.value })}
                disabled={disabled}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Subject</Label>
              <Input
                value={reco.templateSubject ?? ""}
                onChange={(e) => setReco({ ...reco, templateSubject: e.target.value })}
                disabled={disabled}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Message (HTML allowed)</Label>
              <Textarea
                rows={4}
                value={reco.templateMessage ?? ""}
                onChange={(e) => setReco({ ...reco, templateMessage: e.target.value })}
                disabled={disabled}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>URL (optional)</Label>
              <Input
                value={reco.url ?? ""}
                onChange={(e) => setReco({ ...reco, url: e.target.value })}
                disabled={disabled}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
