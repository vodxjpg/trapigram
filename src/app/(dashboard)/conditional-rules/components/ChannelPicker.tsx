"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";

export type Channel = "email" | "telegram" | "in_app" | "webhook";

export default function ChannelsPicker({
  value,
  onChange,
  disabled,
}: {
  value: Channel[];
  onChange: (v: Channel[]) => void;
  disabled?: boolean;
}) {
  const opts = useMemo(
    () => [
      { key: "email" as const, label: "Email" },
      { key: "telegram" as const, label: "Telegram" },
      { key: "in_app" as const, label: "In-app" },
      { key: "webhook" as const, label: "Webhook" },
    ],
    [],
  );

  const toggle = (k: Channel) => {
    const has = value.includes(k);
    onChange(has ? value.filter((v) => v !== k) : [...value, k]);
  };

  return (
    <div className="flex flex-wrap gap-2">
      {opts.map((o) => {
        const active = value.includes(o.key);
        return (
          <Button
            key={o.key}
            type="button"
            variant={active ? "default" : "outline"}
            className="rounded-2xl"
            disabled={disabled}
            onClick={() => toggle(o.key)}
            aria-pressed={active}
          >
            {o.label}
          </Button>
        );
      })}
    </div>
  );
}
