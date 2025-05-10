/* /home/zodx/Desktop/trapigram/src/app/(dashboard)/affiliate-settings/settings-form.tsx */
"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/* ───────────── Types ───────────── */
type Settings = {
  pointsPerReferral: number;
  pointsPerReview: number;
  spendingNeeded: number;
  pointsPerSpending: number;
};

const defaultSettings: Settings = {
  pointsPerReferral: 0,
  pointsPerReview: 0,
  spendingNeeded: 0,
  pointsPerSpending: 0,
};

/* ───────────── Component ───────────── */
export function SettingsForm() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  /* fetch once on mount */
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/affiliate/settings", {
          headers: {
            "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET ?? "",
          },
        });
        if (!res.ok) throw new Error("Fetch failed");
        const data = await res.json();
        setSettings({
          pointsPerReferral: Number(data.pointsPerReferral),
          pointsPerReview: Number(data.pointsPerReview),
          spendingNeeded: Number(data.spendingNeeded),
          pointsPerSpending: Number(data.pointsPerSpending),
        });
      } catch (e: any) {
        toast.error(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /* update helper */
  const onChange =
    (key: keyof Settings) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setSettings((p) => ({ ...p, [key]: Number(e.target.value) }));

  /* save */
  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/affiliate/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET ?? "",
        },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Save failed");
      toast.success("Settings saved");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  /* ───────────── JSX ───────────── */
  return (
    <Card className="p-6 max-w-lg space-y-4 m-auto">
      {loading ? (
        <p className="text-sm">Loading…</p>
      ) : (
        <>
          <div className="grid gap-4">
            <label className="grid gap-1">
              <span className="text-sm font-medium">Points per Referral</span>
              <Input
                type="number"
                value={settings.pointsPerReferral}
                onChange={onChange("pointsPerReferral")}
                min={0}
              />
            </label>

            <label className="grid gap-1">
              <span className="text-sm font-medium">Points per Review</span>
              <Input
                type="number"
                value={settings.pointsPerReview}
                onChange={onChange("pointsPerReview")}
                min={0}
              />
            </label>

            <label className="grid gap-1">
              <span className="text-sm font-medium">
                Spending needed for next award&nbsp;(
                <span className="font-mono">$</span>)
              </span>
              <Input
                type="number"
                value={settings.spendingNeeded}
                onChange={onChange("spendingNeeded")}
                min={0}
                step="0.01"
              />
            </label>

            <label className="grid gap-1">
              <span className="text-sm font-medium">Points per Spending Award</span>
              <Input
                type="number"
                value={settings.pointsPerSpending}
                onChange={onChange("pointsPerSpending")}
                min={0}
              />
            </label>
          </div>

          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </>
      )}
    </Card>
  );
}
