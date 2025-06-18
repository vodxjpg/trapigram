"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import Select from "react-select";
import ReactCountryFlag from "react-country-flag";
import countriesLib from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";
import { usePermission } from "@/hooks/use-permission";

countriesLib.registerLocale(enLocale);
const countryOptions = Object.entries(
  countriesLib.getNames("en")
).map(([code, name]) => ({
  value: code,
  label: (
    <div className="flex items-center gap-2">
      <ReactCountryFlag
        countryCode={code}
        svg
        style={{ width: 16, height: 16 }}
      />
      {name}
    </div>
  ),
}));

export default function ClientDetailView() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const can = usePermission();
  const [client, setClient] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // redirect if no view
  useEffect(() => {
    if (!can.loading && !can({ customer: ["view"] })) {
      router.replace("/clients");
    }
  }, [can, router]);
  if (can.loading || !can({ customer: ["view"] })) return null;

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/clients/${id}`, {
          headers: {
            "x-internal-secret":
              process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "",
          },
        });
        if (!res.ok) throw new Error("Failed to fetch client");
        setClient(await res.json());
      } catch (err: any) {
        toast.error(err.message || "Error loading client");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) return <p className="p-6">Loading…</p>;
  if (!client) return <p className="p-6">Client not found.</p>;

  return (
    <div className="max-w-3xl mx-auto py-10">
      <Card>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Username */}
            <div className="flex flex-col">
              <label className="mb-1 text-sm font-medium">Username</label>
              <Input value={client.username} disabled />
            </div>

            {/* Email */}
            <div className="flex flex-col">
              <label className="mb-1 text-sm font-medium">Email</label>
              <Input value={client.email} disabled />
            </div>

            {/* First Name */}
            <div className="flex flex-col">
              <label className="mb-1 text-sm font-medium">First Name</label>
              <Input value={client.firstName} disabled />
            </div>

            {/* Last Name */}
            <div className="flex flex-col">
              <label className="mb-1 text-sm font-medium">Last Name</label>
              <Input value={client.lastName} disabled />
            </div>

            {/* Phone */}
            <div className="flex flex-col">
              <label className="mb-1 text-sm font-medium">Phone Number</label>
              <Input value={client.phoneNumber} disabled />
            </div>

            {/* Country */}
            <div className="flex flex-col">
              <label className="mb-1 text-sm font-medium">Country</label>
              <Select
                options={countryOptions}
                isClearable
                isDisabled
                value={
                  client.country
                    ? countryOptions.find((o) => o.value === client.country) || null
                    : null
                }
              />
            </div>

            {/* Referred By */}
            <div className="flex flex-col">
              <label className="mb-1 text-sm font-medium">Referred By</label>
              <Input value={client.referredBy || ""} disabled />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
