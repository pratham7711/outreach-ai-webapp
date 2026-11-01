import type { Metadata } from "next";
import { sectionTitle } from "@/lib/ui/pageTitle";

export const metadata: Metadata = { title: sectionTitle("Creator Finder") };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
