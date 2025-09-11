"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import ChannelsPicker, { Channel } from "./ChannelPicker";

export type ActionItem =
  | {
      type: "send_coupon";
      channels: Channel[];
      payload: {
        couponId?: string | null;
        code?: string;
        templateSubject?: string;
        templateMessage?: string;
        url?: string | null;
      };
    }
  | {
      type: "product_recommendation";
      channels: Channel[];
      payload: {
        productIds?: string[];
        collectionId?: string;
        templateSubject?: string;
        templateMessage?: string;
        url?: string | null;
      };
    };

export default function ActionsBuilder({
  actions,
  setActions,
  disabled,
}: {
  actions: ActionItem[];
  setActions: (a: ActionItem[]) => void;
  disabled?: boolean;
}) {
  const add = (type: ActionItem["type"]) => {
    setActions([
      ...actions,
      type === "send_coupon"
        ? { type, channels: ["email"], payload: {} }
        : { type, channels: ["email"], payload: {} },
    ]);
  };
  const remove = (idx: number) => setActions(actions.filter((_, i) => i !== idx));

  const setAt = (idx: number, patch: Partial<ActionItem>) => {
    const next = [...actions];
    next[idx] = { ...next[idx], ...patch } as ActionItem;
    setActions(next);
  };

  const setPayload = (idx: number, patch: any) => {
    const next = [...actions];
    next[idx] = { ...next[idx], payload: { ...(next[idx] as any).payload, ...patch } } as ActionItem;
    setActions(next);
  };

  return (
    <div className="space-y-3">
      {actions.map((a, idx) => (
        <div key={idx} className="grid gap-3 rounded-xl border p-3 md:p-4">
          <div className="flex items-center gap-3">
            <Label className="min-w-24">Type</Label>
            <Select
              value={a.type}
              onValueChange={(v) =>
                setAt(idx, { type: v as ActionItem["type"], payload: {}, channels: a.channels })
              }
              disabled={disabled}
            >
              <SelectTrigger className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="send_coupon">Send coupon</SelectItem>
                <SelectItem value="product_recommendation">Recommend product</SelectItem>
              </SelectContent>
            </Select>

            <div className="ml-auto">
              <Button type="button" variant="outline" onClick={() => remove(idx)} disabled={disabled}>
                − Remove
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Channels</Label>
            <ChannelsPicker
              value={a.channels as Channel[]}
              onChange={(v) => setAt(idx, { channels: v as Channel[] } as any)}
              disabled={disabled}
            />
          </div>

          {a.type === "send_coupon" && (
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Coupon ID</Label>
                <Input
                  value={(a as any).payload.couponId ?? ""}
                  onChange={(e) => setPayload(idx, { couponId: e.target.value })}
                  disabled={disabled}
                />
              </div>
              <div className="space-y-2">
                <Label>Fallback Code</Label>
                <Input
                  value={(a as any).payload.code ?? ""}
                  onChange={(e) => setPayload(idx, { code: e.target.value })}
                  disabled={disabled}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Subject</Label>
                <Input
                  value={(a as any).payload.templateSubject ?? ""}
                  onChange={(e) => setPayload(idx, { templateSubject: e.target.value })}
                  disabled={disabled}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Message (HTML)</Label>
                <Textarea
                  rows={4}
                  value={(a as any).payload.templateMessage ?? ""}
                  onChange={(e) => setPayload(idx, { templateMessage: e.target.value })}
                  disabled={disabled}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>URL (optional)</Label>
                <Input
                  value={(a as any).payload.url ?? ""}
                  onChange={(e) => setPayload(idx, { url: e.target.value })}
                  disabled={disabled}
                />
              </div>
            </div>
          )}

          {a.type === "product_recommendation" && (
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Product IDs (comma)</Label>
                <Input
                  value={((a as any).payload.productIds ?? []).join(",")}
                  onChange={(e) =>
                    setPayload(idx, {
                      productIds: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                    })
                  }
                  disabled={disabled}
                />
              </div>
              <div className="space-y-2">
                <Label>Collection ID</Label>
                <Input
                  value={(a as any).payload.collectionId ?? ""}
                  onChange={(e) => setPayload(idx, { collectionId: e.target.value })}
                  disabled={disabled}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Subject</Label>
                <Input
                  value={(a as any).payload.templateSubject ?? ""}
                  onChange={(e) => setPayload(idx, { templateSubject: e.target.value })}
                  disabled={disabled}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Message (HTML)</Label>
                <Textarea
                  rows={4}
                  value={(a as any).payload.templateMessage ?? ""}
                  onChange={(e) => setPayload(idx, { templateMessage: e.target.value })}
                  disabled={disabled}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>URL (optional)</Label>
                <Input
                  value={(a as any).payload.url ?? ""}
                  onChange={(e) => setPayload(idx, { url: e.target.value })}
                  disabled={disabled}
                />
              </div>
            </div>
          )}
        </div>
      ))}

      <div className="flex gap-2">
        <Button type="button" onClick={() => add("send_coupon")} disabled={disabled}>+ Add “Send coupon”</Button>
        <Button type="button" variant="outline" onClick={() => add("product_recommendation")} disabled={disabled}>
          + Add “Recommend product”
        </Button>
      </div>
    </div>
  );
}
