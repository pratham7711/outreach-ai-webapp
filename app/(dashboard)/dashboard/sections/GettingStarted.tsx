"use client";

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Rocket } from "lucide-react";
import { SectionCard } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { OnboardingChecklist, useDismissable } from "@/components/onboarding/OnboardingChecklist";
import { apiFetch } from "@/lib/api/client";
import { isOnboardingProgress, type OnboardingProgress } from "@/lib/onboarding/steps";
import { BRAND } from "@/lib/brand";

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
