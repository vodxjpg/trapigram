// src/app/(dashboard)/affiliates/settings/page.tsx
// (No "use client" here—this is a Server Component)

export const metadata = {
  title: "Affiliate Settings",
};

import ClientAffiliateSettingsPage from "./components/client-page";

export default function AffiliateSettingsPage() {
  return <ClientAffiliateSettingsPage />;
}
