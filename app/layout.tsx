import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CampaignHub",
  description: "Premium creator campaign management platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
