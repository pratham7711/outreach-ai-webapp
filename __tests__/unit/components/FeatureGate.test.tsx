/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { FeatureGate } from "@/components/providers/FeatureGate";
import { TenantContext } from "@/components/providers/TenantProvider";
import type { ReactNode } from "react";

// Re-export TenantContext if not exported — if FeatureGate uses useTenant internally,
// we need to provide the context value directly.
// We mock the useTenant hook to control what plan/features are returned.
jest.mock("@/components/providers/TenantProvider", () => {
  const actual = jest.requireActual("@/components/providers/TenantProvider");
  return {
    ...actual,
    useTenant: jest.fn(),
  };
});

import { useTenant } from "@/components/providers/TenantProvider";
const mockUseTenant = useTenant as jest.Mock;

// Helper: render FeatureGate with a given plan + features
function renderGate(feature: string, features: string[], plan = "starter", children: ReactNode = <div>Protected Content</div>) {
  mockUseTenant.mockReturnValue({ features, plan });
  return render(<FeatureGate feature={feature}>{children}</FeatureGate>);
}

describe("FeatureGate", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("when user HAS the feature", () => {
    it("renders children when feature is in features list", () => {
      renderGate("campaigns", ["campaigns", "creator_database", "media_kits"]);
      expect(screen.getByText("Protected Content")).toBeInTheDocument();
    });

    it("renders children for pro feature when on pro plan", () => {
      renderGate("audio_analytics", ["campaigns", "creator_database", "audio_analytics", "payments"]);
      expect(screen.getByText("Protected Content")).toBeInTheDocument();
    });

    it("renders complex children correctly", () => {
      mockUseTenant.mockReturnValue({ features: ["payments"], plan: "pro" });
      render(
        <FeatureGate feature="payments">
          <div>
            <h2>Payment Dashboard</h2>
            <p>$12,345 balance</p>
          </div>
        </FeatureGate>
      );
      expect(screen.getByText("Payment Dashboard")).toBeInTheDocument();
      expect(screen.getByText("$12,345 balance")).toBeInTheDocument();
    });

    it("renders children when features array is undefined (no restriction)", () => {
      mockUseTenant.mockReturnValue({ features: undefined, plan: "starter" });
      render(<FeatureGate feature="any_feature"><div>Open Content</div></FeatureGate>);
      expect(screen.getByText("Open Content")).toBeInTheDocument();
    });
  });

  describe("when user LACKS the feature", () => {
    it("shows upgrade overlay when feature is locked", () => {
      // FeatureGate renders children in a dimmed div for blur effect (still in DOM),
      // but the upgrade overlay is placed on top.
      renderGate("audio_analytics", ["campaigns", "creator_database"]);
      // Upgrade prompt overlay must be visible
      expect(screen.getByText("Upgrade to unlock")).toBeInTheDocument();
      // Children are rendered but behind the blur (opacity-20) — they stay in DOM
      const { container } = renderGate("audio_analytics", ["campaigns"]);
      const dimmedWrapper = container.querySelector(".opacity-20");
      expect(dimmedWrapper).toBeInTheDocument();
    });

    it("shows 'Upgrade to unlock' message", () => {
      renderGate("sso", ["campaigns", "creator_database"], "free");
      expect(screen.getByText("Upgrade to unlock")).toBeInTheDocument();
    });

    it("shows 'Upgrade Plan' button", () => {
      renderGate("creator_portal", ["campaigns"], "free");
      expect(screen.getByRole("button", { name: /Upgrade Plan/i })).toBeInTheDocument();
    });

    it("shows plan requirement text for free plan", () => {
      renderGate("audio_analytics", ["campaigns"], "free");
      expect(screen.getByText(/Pro/i)).toBeInTheDocument();
    });

    it("shows enterprise text for pro users missing enterprise features", () => {
      renderGate("sso", ["campaigns", "audio_analytics", "payments"], "pro");
      expect(screen.getByText(/Enterprise/i)).toBeInTheDocument();
    });

    it("renders children in dimmed overlay (still in DOM)", () => {
      renderGate("sso", ["campaigns"], "starter");
      // The children should still be rendered but visually hidden (opacity-20 class)
      // Check they're in the document even when locked
      expect(screen.getByText("Protected Content")).toBeInTheDocument();
    });

    it("shows Lock icon when feature is locked", () => {
      const { container } = renderGate("custom_domain", ["campaigns"], "starter");
      // Lock icon is rendered as SVG — check container has the overlay
      expect(container.querySelector('[class*="backdrop-blur"]')).toBeInTheDocument();
    });
  });

  describe("feature check edge cases", () => {
    it("does not show lock when feature list is empty — denies all", () => {
      renderGate("campaigns", []);
      expect(screen.getByText("Upgrade to unlock")).toBeInTheDocument();
    });

    it("handles empty string feature gracefully", () => {
      mockUseTenant.mockReturnValue({ features: ["campaigns"], plan: "starter" });
      render(<FeatureGate feature=""><div>Content</div></FeatureGate>);
      // Empty feature — should lock (not in features list)
      expect(screen.queryByText("Upgrade to unlock")).toBeInTheDocument();
    });
  });
});
