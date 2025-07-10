// src/app/(dashboard)/affiliates/logs/page.tsx
// (no "use client" here)

export const metadata = {
  title: "Affiliate Logs",
};

import ClientAffiliateLogsPage from "./client-page";

export default function AffiliateLogsPage() {
  return <ClientAffiliateLogsPage />;
}
