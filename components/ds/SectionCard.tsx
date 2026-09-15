import React from "react";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { MetricHint } from "./MetricHint";
import type { MetricKey } from "@/lib/metric-definitions";

type SectionCardProps = {
  icon: LucideIcon;
  title: string;
  description?: string;
  metric?: MetricKey;
  action?: React.ReactNode;
  padded?: boolean;
  className?: string;
  children: React.ReactNode;
};

export function SectionCard({
  icon: Icon,
  title,
  description,
  metric,
  action,
  padded = true,
  className,
  children,
}: SectionCardProps) {
  return (
    <Card className={`cc-section-card gap-0 overflow-hidden py-0 ${className ?? ""}`}>
      <div className="cc-section-card-head flex items-start justify-between gap-4 border-b border-border px-6 py-4">
        <div className="cc-section-card-heading flex items-start gap-3">
          <span className="cc-section-card-icon mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent">
            <Icon aria-hidden="true" className="size-4 text-accent-foreground" strokeWidth={2} />
          </span>
          <div className="cc-section-card-headtext flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
              {/* The class carries the type; the Tailwind arbitrary value that
                  was here (text-[15px] font-semibold) could not be re-pointed
                  by a theme. MEASURED 2026-09-14: their section heading is
                  18px/400 and ours was 15px/600, on every settings section. */}
              <h2 className="cc-section-card-title text-foreground">{title}</h2>
              {metric ? <MetricHint metric={metric} /> : null}
            </div>
            {description ? (
              <p className="cc-section-card-desc text-xs leading-snug text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </div>
        {action ? <div className="cc-section-card-action">{action}</div> : null}
      </div>
      <div className={`cc-section-card-body ${padded ? "px-6 py-5" : ""}`}>{children}</div>
    </Card>
  );
}
