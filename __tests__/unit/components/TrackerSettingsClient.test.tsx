/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

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

  it("offers no retention control, because nothing prunes readings", async () => {
    mockFetch.mockResolvedValue(SETTINGS);

    render(<TrackerSettingsClient />);

    await screen.findByText("Read cadence");
    expect(screen.queryByText("History kept")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Days of history to keep")).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  it("saves only the setting that changed, so the stored retentionDays survives", async () => {
    mockFetch.mockResolvedValue(SETTINGS);

    render(<TrackerSettingsClient />);
    await screen.findByText("Read cadence");

    const cadence = screen.getByRole("radiogroup", { name: "readCadence" });
    const other = within(cadence).getAllByRole("radio").find((r) => !(r as HTMLInputElement).checked)!;
    fireEvent.click(other);

    await waitFor(() =>
      expect(mockFetch.mock.calls.some((c) => c[1]?.method === "PATCH")).toBe(true)
    );
    for (const call of mockFetch.mock.calls.filter((c) => c[1]?.method === "PATCH")) {
      const body = JSON.parse(call[1].body);
      expect(Object.keys(body)).toEqual(["readCadence"]);
    }
  });
});
