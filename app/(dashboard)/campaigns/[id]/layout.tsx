import type { ReactNode } from "react";
import { ExactFigures } from "@/components/ds/ExactFigures";

export default function CampaignDetailLayout({ children }: { children: ReactNode }) {
  return <ExactFigures>{children}</ExactFigures>;
}
