import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: `My accounts · ${BRAND.name}` };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
