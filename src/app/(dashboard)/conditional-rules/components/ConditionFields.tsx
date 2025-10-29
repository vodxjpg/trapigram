// /src/app/(dashboard)/conditional-rules/components/ConditionFields.tsx

"use client";

import { Controller, Control, FieldPath } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

type AnyValues = Record<string, unknown>;

export function CountriesMulti<T extends AnyValues>({
  control,
  name,
  disabled,
}: {
  control: Control<T>;
  name: FieldPath<T>;
  disabled?: boolean;
}) {
  // Simple approach: comma-separated country codes (ISO-2)
  return (
    <div className="space-y-2">
      <Label>Countries (ISO-2, comma separated)</Label>
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <Input
            placeholder="US,GB,ES"
            value={(Array.isArray(field.value) ? field.value : []).join(",")}
            onChange={(e) =>
              field.onChange(
                e.target.value
                  .split(",")
                  .map((s) => s.trim().toUpperCase())
                  .filter(Boolean),
              )
            }
            disabled={disabled}
          />
        )}
      />
      <p className="text-xs text-muted-foreground">
        Leave empty to apply to all countries.
      </p>
    </div>
  );
}

export function CurrencyMulti<T extends AnyValues>({
  control,
  name,
  disabled,
}: {
  control: Control<T>;
  name: FieldPath<T>;
  disabled?: boolean;
}) {
  const options = ["USD", "EUR", "GBP"] as const;

  return (
    <div className="space-y-2">
      <Label>Order currency in</Label>
      <Controller
        control={control}
        name={name}
        render={({ field }) => {
          const value: string[] = Array.isArray(field.value) ? field.value : [];
          const toggle = (code: string) => {
            const has = value.includes(code);
            field.onChange(has ? value.filter((v) => v !== code) : [...value, code]);
          };
          return (
            <div className="grid grid-cols-3 gap-3">
              {options.map((code) => {
                const checked = value.includes(code);
                return (
                  <label key={code} className="flex items-center gap-2">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggle(code)}
                      disabled={disabled}
                    />
                    <span>{code}</span>
                  </label>
                );
              })}
            </div>
          );
        }}
      />
      <p className="text-xs text-muted-foreground">
        Leave empty to apply to all currencies.
      </p>
    </div>
  );
}
