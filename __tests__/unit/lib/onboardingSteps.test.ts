import {
  buildOnboardingSteps,
  isOnboardingProgress,
  onboardingProgress,
  type OnboardingSnapshot,
} from "@/lib/onboarding/steps";
import type { CapabilityReport, CapabilityStatus } from "@/lib/capabilities";

const EMPTY: OnboardingSnapshot = {
  orgType: "AGENCY",
  clients: 0,
  campaigns: 0,
  creators: 0,
  activations: 0,
  postsTracked: 0,
  teamMembers: 1,
  pendingInvites: 0,
  payouts: 0,
};

function capabilities(metrics: Record<string, CapabilityStatus>): CapabilityReport {
  const platforms = Object.entries(metrics).map(([platform, status]) => ({
    platform: platform as never,
    label: platform.charAt(0).toUpperCase() + platform.slice(1),
    connect: "gated" as CapabilityStatus,
    metrics: status,
    connectNote: "",
    metricsNote: "",
  }));
  return {
    platforms,
    anyConnectLive: false,
    anyMetricsLive: platforms.some((p) => p.metrics === "live"),
  };
}

const NO_METRICS = capabilities({ instagram: "coming_soon", tiktok: "coming_soon" });

describe("buildOnboardingSteps", () => {
  it("gives an agency a client step and a brand none", () => {
    const agency = buildOnboardingSteps(EMPTY, NO_METRICS);
    const brand = buildOnboardingSteps({ ...EMPTY, orgType: "BRAND" }, NO_METRICS);

    expect(agency.map((s) => s.key)).toContain("client");
    expect(brand.map((s) => s.key)).not.toContain("client");
    expect(brand).toHaveLength(agency.length - 1);
  });

  it("marks nothing done for a fresh org", () => {
    expect(buildOnboardingSteps(EMPTY, NO_METRICS).every((s) => !s.done)).toBe(true);
  });

  it("counts the sole founding user as no team, but a pending invite as done", () => {
    const byKey = (snapshot: OnboardingSnapshot) =>
      buildOnboardingSteps(snapshot, NO_METRICS).find((s) => s.key === "team")!;

    expect(byKey(EMPTY).done).toBe(false);
    expect(byKey({ ...EMPTY, pendingInvites: 1 }).done).toBe(true);
    expect(byKey({ ...EMPTY, teamMembers: 2 }).done).toBe(true);
  });

  it("does not promise automatic metrics when no platform can collect them", () => {
    const step = buildOnboardingSteps(EMPTY, NO_METRICS).find((s) => s.key === "post")!;
    expect(step.body).toMatch(/not switched on/i);
  });

  it("names the platforms that actually collect metrics", () => {
    const report = capabilities({ instagram: "live", tiktok: "coming_soon" });
    const step = buildOnboardingSteps(EMPTY, report).find((s) => s.key === "post")!;
    expect(step.body).toContain("Instagram");
    expect(step.body).not.toContain("Tiktok");
  });
});

describe("isOnboardingProgress", () => {
  it("rejects the shapes a broken or mocked API can return", () => {
    expect(isOnboardingProgress(undefined)).toBe(false);
    expect(isOnboardingProgress(null)).toBe(false);
    expect(isOnboardingProgress({})).toBe(false);
    expect(isOnboardingProgress({ steps: [], done: 0, total: 0 })).toBe(false);
    expect(isOnboardingProgress({ steps: [{}], done: 0, total: 1 })).toBe(false);
    expect(isOnboardingProgress({ steps: [{ key: "a", href: "/a" }], done: "0", total: 1 })).toBe(
      false,
    );
  });

  it("accepts a real payload", () => {
    expect(isOnboardingProgress(onboardingProgress(EMPTY, NO_METRICS))).toBe(true);
  });
});

describe("onboardingProgress", () => {
  it("reports the first unfinished step as next", () => {
    const progress = onboardingProgress({ ...EMPTY, clients: 3 }, NO_METRICS);
    expect(progress.done).toBe(1);
    expect(progress.complete).toBe(false);
    expect(progress.next?.key).toBe("campaign");
  });

  it("is complete only when every step is done", () => {
    const full: OnboardingSnapshot = {
      orgType: "AGENCY",
      clients: 1,
      campaigns: 1,
      creators: 1,
      activations: 1,
      postsTracked: 1,
      teamMembers: 2,
      pendingInvites: 0,
      payouts: 1,
    };
    const progress = onboardingProgress(full, NO_METRICS);
    expect(progress.complete).toBe(true);
    expect(progress.next).toBeNull();
    expect(progress.done).toBe(progress.total);
  });
});
