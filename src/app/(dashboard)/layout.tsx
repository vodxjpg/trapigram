import type { Metadata } from "next";
import { GoogleAnalytics } from '@next/third-parties/google';
import { Source_Sans_3, Manrope } from "next/font/google";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { SiteHeader } from "@/components/dashboard/site-header";
import FooterDashboard from "@/components/dashboard/FooterDashboard";
import { siteDetails } from '@/data/siteDetails';
import { HeaderTitleProvider } from "@/context/HeaderTitleContext";
import { Toaster } from "@/components/ui/sonner"

import "@/app/globals.css";

const manrope = Manrope({ subsets: ['latin'] });
const sourceSans = Source_Sans_3({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: siteDetails.metadata.title,
  description: siteDetails.metadata.description,
  // ... other metadata
};

export default function DashboardLayout({ children }: { children: React.ReactNode; }) {
  return (
    <html lang="en">
      <body className={`${manrope.className} ${sourceSans.className} antialiased`}>
        {siteDetails.googleAnalyticsId && <GoogleAnalytics gaId={siteDetails.googleAnalyticsId} />}
        <SidebarProvider
          style={{
            "--sidebar-width": "calc(var(--spacing) * 72)",
            "--header-height": "calc(var(--spacing) * 12)",
          } as React.CSSProperties}
        >
          <AppSidebar variant="inset" />
          <SidebarInset>
            <HeaderTitleProvider>
              <SiteHeader />
              <main>{children}</main>
              <Toaster 
                position="bottom-right"
              />
            </HeaderTitleProvider>
            <FooterDashboard />
          </SidebarInset>
        </SidebarProvider>
      </body>
    </html>
  );
}
