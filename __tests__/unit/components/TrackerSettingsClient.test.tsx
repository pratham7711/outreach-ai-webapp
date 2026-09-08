/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";

jest.mock("@pratham7711/ui", () => ({
  Card: ({ children }: any) => <div>{children}</div>,
  Skeleton: () => <div data-testid="skeleton" />,
}), { virtual: true });

jest.mock("@/components/ds", () => ({
  Button: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
}));

jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

/* ApiError has to survive the mock: lib/api/errorMessage does `instanceof
   ApiError`, which throws outright if the export is undefined. */
jest.mock("@/lib/api/client", () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {},
}));

import { apiFetch } from "@/lib/api/client";
import { TrackerSettingsClient } from "@/app/(dashboard)/settings/trackers/TrackerSettingsClient";

const mockFetch = apiFetch as jest.Mock;

const SETTINGS = {
  readCadence: "4hourly",
  chartGranularity: "daily",
  retentionDays: 365,
  effectiveChartGranularity: "daily",
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("TrackerSettingsClient", () => {
  it("shows a recoverable error instead of a blank page when the load fails", async () => {
    mockFetch.mockRejectedValue(new Error("Forbidden"));

    const { container } = render(<TrackerSettingsClient />);

    await waitFor(() =>
      expect(screen.getByText("Tracker settings could not be loaded")).toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    // The old behaviour was `return null` — nothing rendered at all.
    expect(container).not.toBeEmptyDOMElement();
  });

  it("renders retention read-only and says nothing prunes yet", async () => {
    mockFetch.mockResolvedValue(SETTINGS);

    render(<TrackerSettingsClient />);

    const input = await screen.findByLabelText("Days of history to keep");
    expect(input).toBeDisabled();
    expect(input).toHaveValue(365);
    expect(
      screen.getByText(/Nothing prunes readings yet/i)
    ).toBeInTheDocument();
  });

  it("never sends a retentionDays PATCH, because the control cannot be edited", async () => {
    mockFetch.mockResolvedValue(SETTINGS);

    render(<TrackerSettingsClient />);
    await screen.findByLabelText("Days of history to keep");

    for (const call of mockFetch.mock.calls) {
      expect(call[1]?.method).not.toBe("PATCH");
    }
  });
});
