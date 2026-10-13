import type { Metadata } from "next";
import { sectionTitle } from "@/lib/ui/pageTitle";

/* Names this section's browser tab: "Requests · Made Boring Campaigns". Every tab
   in the app used to read only "Made Boring Campaigns", so six open tabs were
   indistinguishable. Same wording as the top bar's breadcrumb
   (components/layout/TopBar PAGE_TITLES). */
export const metadata: Metadata = { title: sectionTitle("Requests") };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
