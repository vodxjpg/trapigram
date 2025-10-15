// src/app/(dashboard)/affiliates/page.tsx  (SERVER component)
export const metadata = {
  title: "Affiliates",
};

import ClientDashboard from "./client-dashboard";
export default function AffiliatesDashboardPage() {
  return (
    <div>
      <ClientDashboard />;
    </div>
  )
}
