/* /src/app/(dashboard)/affiliates/settings/components/settings-form.tsx */
"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { X } from "lucide-react";

/*──────── Types ────────*/
type Settings = {
  pointsPerReferral: number;
  pointsPerReview: number;
  spendingNeeded: number;
  pointsPerSpending: number;
};
type Group = {
  id: string;
  groupId: string;
  groupName: string;
  points: number;
};

/*──────── Component ────────*/
export function SettingsForm() {
  const [settings, setSettings] = useState<Settings>({
    pointsPerReferral: 0,
    pointsPerReview: 0,
    spendingNeeded: 0,
    pointsPerSpending: 0,
  });
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  /* fetch settings + groups once */
  useEffect(() => {
    (async () => {
      try {
        const [sRes, gRes] = await Promise.all([
          fetch("/api/affiliate/settings", {
            headers: { "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET ?? "" },
          }),
          fetch("/api/affiliate/groups", {
            headers: { "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET ?? "" },
          }),
        ]);
        if (!sRes.ok || !gRes.ok) throw new Error("Fetch failed");
        const sData = await sRes.json();
        const gData = await gRes.json();
        setSettings({
          pointsPerReferral: Number(sData.pointsPerReferral),
          pointsPerReview: Number(sData.pointsPerReview),
          spendingNeeded: Number(sData.spendingNeeded),
          pointsPerSpending: Number(sData.pointsPerSpending),
        });
        setGroups(gData.groups);
      } catch (e: any) {
        toast.error(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /* settings change helper */
  const onChange =
    (key: keyof Settings) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setSettings((p) => ({ ...p, [key]: Number(e.target.value) }));

  /* save or delete a single group row */
  const saveGroup = async (g: Group) => {
    try {
      const res = await fetch(`/api/affiliate/groups/${g.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET ?? "",
        },
        body: JSON.stringify({ points: g.points }),
      });
      if (!res.ok) throw new Error("Save failed");
      toast.success("Saved");
    } catch (e: any) {
      toast.error(e.message);
    }
  };
  const deleteGroup = async (id: string) => {
    if (!confirm("Remove this group reward?")) return;
    try {
      const res = await fetch(`/api/affiliate/groups/${id}`, {
        method: "DELETE",
        headers: { "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET ?? "" },
      });
      if (!res.ok) throw new Error("Delete failed");
      setGroups((g) => g.filter((x) => x.id !== id));
      toast.success("Removed");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  /* save global settings */
  const saveSettings = async () => {
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
      if (!res.ok) throw new Error("Save failed");
      toast.success("Settings saved");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };


  /*──────── JSX ────────*/
  return (
    <Card className="p-6 max-w-lg space-y-6 m-auto">
      {loading ? (
        <p className="text-sm">Loading…</p>
      ) : (
        <>
          {/*──────────────── core settings ────────────────*/}
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
                Spending needed for next award <span className="font-mono">$</span>
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

          <Button onClick={saveSettings} disabled={saving}>
            {saving ? "Saving…" : "Save Settings"}
          </Button>

           {/*─ group rewards ─*/}
           <div className="space-y-2">
            <h2 className="font-semibold text-lg">Group Join Rewards</h2>
            <p className="text-sm text-muted-foreground">
              Groups are registered by the Telegram bot.  Set the reward per join or use the
              ✕ button to disable.
            </p>

            {groups.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No groups registered yet—invite the bot first to any group, make it a visible admin and register the group using the command /affiliate_group
              </p>
            )}

            {groups.map((g) => (
              <div
                key={g.id}
                className="flex items-center gap-2 border rounded-lg p-3"
              >
                <div className="flex-1">
                  <p className="font-medium">@{g.groupId}</p>
                  <p className="text-muted-foreground text-xs">{g.groupName}</p>
                </div>

                <Input
                  type="number"
                  className="w-24"
                  value={g.points}
                  onChange={(e) =>
                    setGroups((arr) =>
                      arr.map((x) =>
                        x.id === g.id ? { ...x, points: Number(e.target.value) } : x,
                      ),
                    )
                  }
                  min={0}
                />
                <Button variant="outline" size="sm" onClick={() => saveGroup(g)}>
                  Save
                </Button>
                <Button variant="ghost" size="icon" onClick={() => deleteGroup(g.id)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}