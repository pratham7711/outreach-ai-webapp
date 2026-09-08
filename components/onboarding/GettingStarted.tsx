"use client";

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Rocket } from "lucide-react";
import { SectionCard } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { OnboardingChecklist, useDismissable } from "./OnboardingChecklist";
import { apiFetch } from "@/lib/api/client";
import { isOnboardingProgress, type OnboardingProgress } from "@/lib/onboarding/steps";
import { BRAND } from "@/lib/brand";

/**
 * Rendered on /dashboard and on /campaigns.
 *
 * It used to be mounted on /dashboard alone, and sign-in lands on /campaigns
 * (lib/auth.config.ts), so the checklist that exists to get a new org started
 * was on a page a new org had no reason to open. It renders wherever it is
 * mounted only while the checklist is incomplete and undismissed — the two
 * conditions below — rather than only while the org has no campaigns: gating on
 * that would take it away after step two and put the remaining five steps back
 * out of reach, which is the bug, not the fix.
 */
export function GettingStarted() {
  const { dismissed, dismiss } = useDismissable("onboarding.checklist.dismissed");

  const { data } = useQuery({
    queryKey: ["onboarding"],
    queryFn: () => apiFetch<OnboardingProgress>("/api/onboarding"),
    enabled: dismissed === false,
    staleTime: 60_000,
  });

  if (dismissed !== false || !isOnboardingProgress(data) || data.complete) return null;

  return (
    <SectionCard
      icon={Rocket}
      title={`Get set up on ${BRAND.name}`}
      description={`${data.done} of ${data.total} done. Each step turns on a part of the dashboard below.`}
      padded={false}
      action={
        <Button variant="ghost" size="sm" onClick={dismiss}>
          Dismiss
        </Button>
      }
    >
      <OnboardingChecklist progress={data} />
    </SectionCard>
  );
}
