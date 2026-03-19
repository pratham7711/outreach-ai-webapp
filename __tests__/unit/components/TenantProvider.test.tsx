/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor, act } from "@testing-library/react";
import { TenantProvider, useTenant } from "@/components/providers/TenantProvider";
import { useEffect } from "react";

// Helper component to expose the context value
function TenantConsumer({ onValue }: { onValue: (v: ReturnType<typeof useTenant>) => void }) {
  const config = useTenant();
  useEffect(() => {
    onValue(config);
  });
  return <div data-testid="consumer">{config.plan ?? "no-plan"}</div>;
}

describe("TenantProvider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear any CSS variables set on documentElement
    document.documentElement.style.removeProperty("--color-primary");
    document.documentElement.style.removeProperty("--color-secondary");
    document.documentElement.style.removeProperty("--color-accent");
    document.documentElement.style.removeProperty("--font-family");
  });

  describe("children rendering", () => {
    it("renders children immediately", async () => {
      (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({ ok: false });
      render(
        <TenantProvider>
          <div>Hello World</div>
        </TenantProvider>
      );
      expect(screen.getByText("Hello World")).toBeInTheDocument();
    });
  });

  describe("useTenant hook", () => {
    it("returns empty config initially (before fetch)", () => {
      (global.fetch as jest.Mock) = jest.fn().mockImplementation(
        () => new Promise(() => {}) // never resolves
      );
      const capturedValues: ReturnType<typeof useTenant>[] = [];
      render(
        <TenantProvider>
          <TenantConsumer onValue={(v) => capturedValues.push(v)} />
        </TenantProvider>
      );
      // First render — empty config
      expect(capturedValues[0]).toEqual({});
    });

    it("returns config after successful fetch", async () => {
      const mockConfig = {
        primaryColor: "#FF0000",
        secondaryColor: "#00FF00",
        accentColor: "#0000FF",
        fontFamily: "Roboto",
        plan: "pro",
        features: ["campaigns", "audio_analytics"],
      };
      (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockConfig,
      });

      const capturedValues: ReturnType<typeof useTenant>[] = [];
      render(
        <TenantProvider>
          <TenantConsumer onValue={(v) => capturedValues.push(v)} />
        </TenantProvider>
      );

      await waitFor(() => {
        const last = capturedValues[capturedValues.length - 1];
        expect(last.plan).toBe("pro");
      });
    });

    it("keeps empty config when fetch returns non-ok response", async () => {
      (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({ ok: false });

      const capturedValues: ReturnType<typeof useTenant>[] = [];
      render(
        <TenantProvider>
          <TenantConsumer onValue={(v) => capturedValues.push(v)} />
        </TenantProvider>
      );

      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      // Should stay as empty config — not throw
      const last = capturedValues[capturedValues.length - 1];
      expect(last.plan).toBeUndefined();
    });

    it("keeps empty config when fetch throws (network error)", async () => {
      (global.fetch as jest.Mock) = jest.fn().mockRejectedValue(new Error("Network error"));

      const capturedValues: ReturnType<typeof useTenant>[] = [];
      render(
        <TenantProvider>
          <TenantConsumer onValue={(v) => capturedValues.push(v)} />
        </TenantProvider>
      );

      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      const last = capturedValues[capturedValues.length - 1];
      expect(last.plan).toBeUndefined();
    });
  });

  describe("CSS variable injection", () => {
    it("sets --color-primary CSS variable from config", async () => {
      (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ primaryColor: "#ABCDEF" }),
      });

      render(
        <TenantProvider>
          <div>test</div>
        </TenantProvider>
      );

      await waitFor(() => {
        expect(document.documentElement.style.getPropertyValue("--color-primary")).toBe("#ABCDEF");
      });
    });

    it("sets --color-secondary CSS variable from config", async () => {
      (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ secondaryColor: "#111222" }),
      });

      render(<TenantProvider><div>test</div></TenantProvider>);

      await waitFor(() => {
        expect(document.documentElement.style.getPropertyValue("--color-secondary")).toBe("#111222");
      });
    });

    it("sets --font-family CSS variable from config", async () => {
      (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ fontFamily: "Poppins" }),
      });

      render(<TenantProvider><div>test</div></TenantProvider>);

      await waitFor(() => {
        expect(document.documentElement.style.getPropertyValue("--font-family")).toBe("Poppins");
      });
    });

    it("does not set CSS variables when values are absent", async () => {
      (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ plan: "free" }), // no color fields
      });

      render(<TenantProvider><div>test</div></TenantProvider>);

      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(document.documentElement.style.getPropertyValue("--color-primary")).toBe("");
    });

    it("does not set CSS vars when fetch fails", async () => {
      (global.fetch as jest.Mock) = jest.fn().mockRejectedValue(new Error("fail"));

      render(<TenantProvider><div>test</div></TenantProvider>);

      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(document.documentElement.style.getPropertyValue("--color-primary")).toBe("");
    });
  });

  describe("fetch call", () => {
    it("calls /api/tenant/config on mount", async () => {
      const mockFetch = jest.fn().mockResolvedValue({ ok: false });
      (global.fetch as jest.Mock) = mockFetch;

      render(<TenantProvider><div>x</div></TenantProvider>);

      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(mockFetch).toHaveBeenCalledWith("/api/tenant/config");
    });

    it("only calls fetch once on mount", async () => {
      const mockFetch = jest.fn().mockResolvedValue({ ok: false });
      (global.fetch as jest.Mock) = mockFetch;

      render(<TenantProvider><div>x</div></TenantProvider>);

      await act(async () => {
        await new Promise((r) => setTimeout(r, 100));
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
