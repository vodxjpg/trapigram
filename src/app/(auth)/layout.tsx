import type { Metadata } from "next";
import { GoogleAnalytics } from '@next/third-parties/google';
import { Source_Sans_3, Manrope } from "next/font/google";

import Header from "@/components/Header";
import FooterDashboard from "@/components/dashboard/FooterDashboard";
import { siteDetails } from '@/data/siteDetails';
import { Toaster } from 'react-hot-toast';
import "@/app/globals.css";

const manrope = Manrope({ subsets: ['latin'] });
const sourceSans = Source_Sans_3({ subsets: ['latin'] });

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${manrope.className} ${sourceSans.className} antialiased`}
      >
        {siteDetails.googleAnalyticsId && <GoogleAnalytics gaId={siteDetails.googleAnalyticsId} />}
        <main>
          {children}
          <Toaster
            position="bottom-right"
            reverseOrder={false}
          />
        </main>
      </body>
    </html>
  );
}
