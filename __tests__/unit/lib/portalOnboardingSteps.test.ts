import {
  buildCreatorOnboardingSteps,
  creatorOnboardingProgress,
  type CreatorOnboardingSnapshot,
} from "@/lib/onboarding/portalSteps";
import type { CapabilityReport, CapabilityStatus } from "@/lib/capabilities";

const EMPTY: CreatorOnboardingSnapshot = {
  hasBio: false,
  hasAvatar: false,
  rate: null,
  connectedAccounts: 0,
  hasPayoutDetails: false,
  proposals: 0,
};

function capabilities(connect: Record<string, CapabilityStatus>): CapabilityReport {
  const platforms = Object.entries(connect).map(([platform, status]) => ({
    platform: platform as never,
    label: platform.charAt(0).toUpperCase() + platform.slice(1),
    connect: status,
    metrics: "coming_soon" as CapabilityStatus,
    connectNote: "",
    metricsNote: "",
  }));
  return {
    platforms,
    anyConnectLive: platforms.some((p) => p.connect === "live"),
    anyMetricsLive: false,
  };
}

const NOTHING_CONNECTABLE = capabilities({ tiktok: "coming_soon", instagram: "gated" });

describe("buildCreatorOnboardingSteps", () => {
  it("omits the connect step entirely when no platform can be connected", () => {
    const keys = buildCreatorOnboardingSteps(EMPTY, NOTHING_CONNECTABLE).map((s) => s.key);
    expect(keys).not.toContain("connect");
    expect(keys).toEqual(["profile", "rate", "payout", "proposal"]);
  });

  it("offers the connect step and names only the live platforms", () => {
    const report = capabilities({ tiktok: "coming_soon", instagram: "live", youtube: "live" });
    const step = buildCreatorOnboardingSteps(EMPTY, report).find((s) => s.key === "connect")!;
    expect(step.body).toContain("Instagram or Youtube");
    expect(step.body).not.toContain("Tiktok");
  });

  it("needs both a photo and a bio before the profile step is done", () => {
    const profile = (snapshot: CreatorOnboardingSnapshot) =>
      buildCreatorOnboardingSteps(snapshot, NOTHING_CONNECTABLE).find((s) => s.key === "profile")!;

    expect(profile({ ...EMPTY, hasBio: true }).done).toBe(false);
    expect(profile({ ...EMPTY, hasAvatar: true }).done).toBe(false);
    expect(profile({ ...EMPTY, hasBio: true, hasAvatar: true }).done).toBe(true);
  });

  it("treats a zero rate as unset", () => {
    const rate = (value: number | null) =>
      buildCreatorOnboardingSteps({ ...EMPTY, rate: value }, NOTHING_CONNECTABLE).find(
        (s) => s.key === "rate",
      )!;

    expect(rate(null).done).toBe(false);
    expect(rate(0).done).toBe(false);
    expect(rate(500).done).toBe(true);
  });
});

describe("creatorOnboardingProgress", () => {
  it("can reach complete when the platform cannot be connected", () => {
    const progress = creatorOnboardingProgress(
      { hasBio: true, hasAvatar: true, rate: 250, connectedAccounts: 0, hasPayoutDetails: true, proposals: 2 },
      NOTHING_CONNECTABLE,
    );
    expect(progress.complete).toBe(true);
    expect(progress.total).toBe(4);
  });
});
