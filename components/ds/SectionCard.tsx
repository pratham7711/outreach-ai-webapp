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
    <Card className={`gap-0 overflow-hidden py-0 ${className ?? ""}`}>
      <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent">
            <Icon aria-hidden="true" className="size-4 text-accent-foreground" strokeWidth={2} />
          </span>
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
              <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">
                {title}
              </h2>
              {metric ? <MetricHint metric={metric} /> : null}
            </div>
            {description ? (
              <p className="text-xs leading-snug text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </div>
        {action}
      </div>
      <div className={padded ? "px-6 py-5" : ""}>{children}</div>
    </Card>
  );
}
