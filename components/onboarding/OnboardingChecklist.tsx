"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import type { OnboardingProgress } from "@/lib/onboarding/steps";

/**
 * Per-browser dismissal. The checklist is a nudge for one person, not org
 * state, so it does not belong in the database.
 */
export function useDismissable(key: string) {
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    setDismissed(window.localStorage.getItem(key) === "1");
  }, [key]);

  const dismiss = useCallback(() => {
    window.localStorage.setItem(key, "1");
    setDismissed(true);
  }, [key]);

  return { dismissed, dismiss };
}

export function OnboardingChecklist({ progress }: { progress: OnboardingProgress }) {
  const pct = Math.round((progress.done / progress.total) * 100);

  return (
    <>
      <div className="h-1 w-full bg-muted" role="presentation">
        <div
          className="h-full bg-primary transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>

      <ol className="flex flex-col divide-y divide-border">
        {progress.steps.map((step, i) => (
          <li key={step.key}>
            <Link
              href={step.href}
              className="group flex items-center gap-4 px-6 py-4 transition-colors hover:bg-muted/60"
            >
              <span
                className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums ${
                  step.done
                    ? "bg-primary text-primary-foreground"
                    : "bg-accent text-accent-foreground"
                }`}
              >
                {step.done ? <Check aria-hidden="true" className="size-3.5" /> : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={`block text-sm font-semibold ${
                    step.done ? "text-muted-foreground line-through" : "text-foreground"
                  }`}
                >
                  {step.title}
                </span>
                {!step.done && (
                  <span className="block text-[13px] leading-snug text-muted-foreground">
                    {step.body}
                  </span>
                )}
              </span>
              {!step.done && (
                <span className="hidden shrink-0 items-center gap-1 text-[13px] font-semibold text-primary sm:flex">
                  {step.cta}
                  <ArrowRight
                    aria-hidden="true"
                    className="size-3.5 transition-transform group-hover:translate-x-0.5"
                  />
                </span>
              )}
            </Link>
          </li>
        ))}
      </ol>
    </>
  );
}
