import type { CapabilityReport } from "@/lib/capabilities";
import { summarise, type OnboardingProgress, type OnboardingStep } from "./steps";

export type CreatorOnboardingSnapshot = {
  hasBio: boolean;
  hasAvatar: boolean;
  rate: number | null;
  connectedAccounts: number;
  hasPayoutDetails: boolean;
  proposals: number;
};

export function buildCreatorOnboardingSteps(
  snapshot: CreatorOnboardingSnapshot,
  capabilities: CapabilityReport,
): OnboardingStep[] {
  const steps: OnboardingStep[] = [
    {
      key: "profile",
      title: "Finish your profile",
      body: "A photo and a short bio. This is what an agency sees before it decides who to brief.",
      href: "/portal/settings",
      cta: "Edit profile",
      done: snapshot.hasBio && snapshot.hasAvatar,
    },
    {
      key: "rate",
      title: "Set your rate",
      body: "Your asking price per deliverable. You can still negotiate on any individual campaign — this is the number you start from.",
      href: "/portal/settings",
      cta: "Set a rate",
      done: snapshot.rate != null && snapshot.rate > 0,
    },
  ];

  const connectable = capabilities.platforms.filter((p) => p.connect === "live");
  if (connectable.length > 0) {
    steps.push({
      key: "connect",
      title: "Connect your account",
      body: `Link ${connectable.map((p) => p.label).join(" or ")} and your post metrics update on their own, so nobody has to ask you for a screenshot. You can disconnect it here at any time and the token is deleted.`,
      href: "/portal/settings",
      cta: "Connect an account",
      done: snapshot.connectedAccounts > 0,
    });
  }

  steps.push(
    {
      key: "payout",
      title: "Add your payout details",
      body: "Where the money goes when a campaign settles. Nothing is paid out until you add this.",
      href: "/portal/settings",
      cta: "Add bank details",
      done: snapshot.hasPayoutDetails,
    },
    {
      key: "proposal",
      title: "Send your first proposal",
      body: "Browse open campaigns and tell them your rate. You will see the reply in your inbox here.",
      href: "/portal/discover",
      cta: "Discover campaigns",
      done: snapshot.proposals > 0,
    },
  );

  return steps;
}

export function creatorOnboardingProgress(
  snapshot: CreatorOnboardingSnapshot,
  capabilities: CapabilityReport,
): OnboardingProgress {
  return summarise(buildCreatorOnboardingSteps(snapshot, capabilities));
}
