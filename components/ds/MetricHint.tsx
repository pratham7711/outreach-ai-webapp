"use client";

import React from "react";
import { HelpCircle } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { METRIC_DEFINITIONS, type MetricKey } from "@/lib/metric-definitions";

type MetricHintProps = {
  metric?: MetricKey;
  label?: string;
  what?: string;
  how?: string;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
};

export function MetricHint({
  metric,
  label,
  what,
  how,
  side = "top",
  className,
}: MetricHintProps) {
  const definition = metric ? METRIC_DEFINITIONS[metric] : undefined;
  const body = what ?? definition?.what;
  const calculation = how ?? definition?.how;
  const name = label ?? definition?.label ?? "this metric";

  if (!body) return null;

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={120}
        aria-label={`What does ${name} mean?`}
        className={[
          "inline-flex size-4 shrink-0 items-center justify-center rounded-full",
          "text-muted-foreground/70 transition-colors",
          "hover:text-foreground focus-visible:text-foreground",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          className ?? "",
        ].join(" ")}
      >
        <HelpCircle aria-hidden="true" className="size-3.5" strokeWidth={2} />
      </PopoverTrigger>
      <PopoverContent side={side} className="w-64 gap-1.5 px-3 py-2.5">
        <PopoverTitle className="text-[13px] leading-snug font-semibold text-foreground">
          {name}
        </PopoverTitle>
        <PopoverDescription className="text-[13px] leading-snug">{body}</PopoverDescription>
        {calculation ? (
          <p className="border-t border-border pt-1.5 text-[11px] leading-snug text-muted-foreground">
            {calculation}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
