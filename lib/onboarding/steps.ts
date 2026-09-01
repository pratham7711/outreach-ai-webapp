import type { CapabilityReport } from "@/lib/capabilities";
import { joinNames } from "./list";

export type OnboardingSnapshot = {
  orgType: "AGENCY" | "BRAND";
  clients: number;
  campaigns: number;
  creators: number;
  activations: number;
  postsTracked: number;
  teamMembers: number;
  pendingInvites: number;
  payouts: number;
};

export type OnboardingStep = {
  key: string;
  title: string;
  body: string;
  href: string;
  cta: string;
  done: boolean;
};

export type OnboardingProgress = {
  steps: OnboardingStep[];
  done: number;
  total: number;
  complete: boolean;
  next: OnboardingStep | null;
};

function trackingBody(capabilities: CapabilityReport): string {
  const live = capabilities.platforms.filter((p) => p.metrics === "live").map((p) => p.label);
  if (live.length === 0) {
    return "Paste the URL of a post a creator published. It attaches to the campaign and to the creator who earned it. Automatic metric collection is not switched on in this environment yet, so the counts stay at whatever you enter.";
  }
  return `Paste the URL of a post a creator published. ${joinNames(live)} counts refresh on their own from there, so the number you quote a client is the number that is true.`;
}

export function buildOnboardingSteps(
  snapshot: OnboardingSnapshot,
  capabilities: CapabilityReport,
): OnboardingStep[] {
  const steps: OnboardingStep[] = [];

  if (snapshot.orgType === "AGENCY") {
    steps.push({
      key: "client",
      title: "Add the brand you are working for",
      body: "Campaigns hang off a client, so the reporting you hand over is already grouped the way you invoice.",
      href: "/clients",
      cta: "Add a client",
      done: snapshot.clients > 0,
    });
  }

  steps.push(
    {
      key: "campaign",
      title: "Create your first campaign",
      body: "A campaign holds the brief, the budget and every creator you approach for it. Everything else in here attaches to one.",
      href: "/campaigns",
      cta: "New campaign",
      done: snapshot.campaigns > 0,
    },
    {
      key: "creator",
      title: "Add creators to your roster",
      body: "Add them by hand or pull them in from discovery. Rates and contact details live on the creator, not in a thread.",
      href: "/creators",
      cta: "Add a creator",
      done: snapshot.creators > 0,
    },
    {
      key: "activation",
      title: "Put a creator on the campaign",
      body: "An activation is one creator's deliverable on one campaign — the rate you agreed and what they owe you.",
      href: "/activations",
      cta: "Create an activation",
      done: snapshot.activations > 0,
    },
    {
      key: "post",
      title: "Track a published post",
      body: trackingBody(capabilities),
      href: "/campaigns",
      cta: "Open a campaign",
      done: snapshot.postsTracked > 0,
    },
    {
      key: "team",
      title: "Invite your team",
      body: "Everyone on the campaign opens the same rows and sees the same numbers, instead of a spreadsheet somebody retyped.",
      href: "/settings/team",
      cta: "Invite a teammate",
      done: snapshot.teamMembers > 1 || snapshot.pendingInvites > 0,
    },
    {
      key: "payout",
      title: "Pay a creator",
      body: "The payout records against the creator who earned it, so what you approved and what left the account stay reconciled.",
      href: "/payouts",
      cta: "Record a payout",
      done: snapshot.payouts > 0,
    },
  );

  return steps;
}

/** The checklist renders whatever an API hands it, so check the shape first. */
export function isOnboardingProgress(value: unknown): value is OnboardingProgress {
  const p = value as OnboardingProgress | null;
  return (
    !!p &&
    Array.isArray(p.steps) &&
    p.steps.length > 0 &&
    p.steps.every((s) => typeof s?.key === "string" && typeof s?.href === "string") &&
    typeof p.done === "number" &&
    typeof p.total === "number" &&
    p.total > 0
  );
}

export function summarise(steps: OnboardingStep[]): OnboardingProgress {
  const done = steps.filter((s) => s.done).length;
  return {
    steps,
    done,
    total: steps.length,
    complete: done === steps.length,
    next: steps.find((s) => !s.done) ?? null,
  };
}

export function onboardingProgress(
  snapshot: OnboardingSnapshot,
  capabilities: CapabilityReport,
): OnboardingProgress {
  return summarise(buildOnboardingSteps(snapshot, capabilities));
}
