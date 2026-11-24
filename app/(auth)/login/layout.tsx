import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: `Sign in · ${BRAND.name}` };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
