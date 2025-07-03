// src/app/(dashboard)/clients/[id]/info/client-form-read-only.tsx
"use client";

import { useState, useEffect, useMemo }    from "react";
import { useRouter }                       from "next/navigation";
import { toast }                           from "sonner";
import Select                              from "react-select";
import ReactCountryFlag                    from "react-country-flag";
import countriesLib                        from "i18n-iso-countries";
import enLocale                            from "i18n-iso-countries/langs/en.json";

import { authClient }                      from "@/lib/auth-client";
import { useHasPermission }                from "@/hooks/use-has-permission";
import { Card, CardContent }               from "@/components/ui/card";
import { Input }                           from "@/components/ui/input";

countriesLib.registerLocale(enLocale);

const countryOptions = Object.entries(countriesLib.getNames("en")).map(
  ([code, name]) => ({
    value: code,
    label: (
      <div className="flex items-center gap-2">
        <ReactCountryFlag countryCode={code} svg style={{ width: 16, height: 16 }} />
        {name}
      </div>
    ),
  }),
);

interface Props {
  clientId: string;
}

export default function ClientDetailView({ clientId }: Props) {
  const router = useRouter();

  /* active org → permission */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId      = activeOrg?.id ?? null;

  const {
    hasPermission: viewPerm,
    isLoading:     viewLoading,
  } = useHasPermission(organizationId, { customer: ["view"] });

  const canView = useMemo(() => !viewLoading && viewPerm, [viewLoading, viewPerm]);

  /* redirect if not allowed */
  useEffect(() => {
    if (!viewLoading && !viewPerm) {
      router.replace("/clients");
    }
  }, [viewLoading, viewPerm, router]);

  /* data */
  const [client, setClient]   = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!canView) return;

    (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}`, {
          headers: {
            "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "",
          },
        });
        if (!res.ok) throw new Error("Failed to fetch client");
        setClient(await res.json());
      } catch (err: any) {
        toast.error(err.message || "Error loading client");
        router.replace("/clients");
      } finally {
        setLoading(false);
      }
    })();
  }, [canView, clientId, router]);

  if (viewLoading || !canView) return null; // guard while resolving perms
  if (loading) return <p className="p-6">Loading…</p>;
  if (!client) return <p className="p-6">Client not found.</p>;

  /* ---------------------------------------------------------------------- */
  return (
    <div className="max-w-3xl mx-auto py-10">
      <Card>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Username */}
            <Field label="Username" value={client.username} />
            {/* Email */}
            <Field label="Email"    value={client.email} />
            {/* First Name */}
            <Field label="First Name" value={client.firstName} />
            {/* Last Name */}
            <Field label="Last Name"  value={client.lastName} />
            {/* Phone */}
            <Field label="Phone Number" value={client.phoneNumber} />
            {/* Country */}
            <div className="flex flex-col">
              <label className="mb-1 text-sm font-medium">Country</label>
              <Select
                options={countryOptions}
                isDisabled
                isClearable
                value={
                  client.country
                    ? countryOptions.find((o) => o.value === client.country) || null
                    : null
                }
              />
            </div>
            {/* Referred By */}
            <Field label="Referred By" value={client.referredBy || ""} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* small presenter */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <label className="mb-1 text-sm font-medium">{label}</label>
      <Input value={value} disabled />
    </div>
  );
}
