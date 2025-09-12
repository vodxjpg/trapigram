"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

const EVENTS = [
  "order_placed",
  "order_partially_paid",
  "order_pending_payment",
  "order_paid",
  "order_completed",
  "order_cancelled",
  "order_refunded",
] as const;

export type EventKey = (typeof EVENTS)[number];

export default function EventsMulti({
  value,
  onChange,
  disabled,
}: {
  value: EventKey[];
  onChange: (v: EventKey[]) => void;
  disabled?: boolean;
}) {
  const toggle = (k: EventKey) => {
    const has = value.includes(k);
    onChange(has ? (value.filter((v) => v !== k) as EventKey[]) : ([...value, k] as EventKey[]));
  };
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
      {EVENTS.map((ev) => {
        const checked = value.includes(ev);
        return (
          <label key={ev} className="flex items-center gap-2">
            <Checkbox disabled={disabled} checked={checked} onCheckedChange={() => toggle(ev)} />
            <span className="capitalize">{ev.replaceAll("_", " ")}</span>
          </label>
        );
      })}
    </div>
  );
}
