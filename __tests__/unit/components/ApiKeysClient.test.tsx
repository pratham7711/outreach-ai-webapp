/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

jest.mock("@/components/ds", () => ({
  PageHeader: ({ title }: any) => <h1>{title}</h1>,
}));

jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

import ApiKeysClient from "@/app/(dashboard)/settings/api-keys/ApiKeysClient";

function mockFetchOnce(res: { ok: boolean; status?: number; body: unknown }) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: res.ok,
    status: res.status ?? (res.ok ? 200 : 500),
    json: async () => res.body,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn() as any;
});

describe("ApiKeysClient empty state", () => {
  it("says 'No API keys yet' only when the server actually returned none", async () => {
    mockFetchOnce({ ok: true, body: { keys: [] } });

    render(<ApiKeysClient />);

    expect(await screen.findByText("No API keys yet")).toBeInTheDocument();
  });

  it("does not claim the org has no keys when the request is refused", async () => {
    mockFetchOnce({ ok: false, status: 403, body: {} });

    render(<ApiKeysClient />);

    await waitFor(() =>
      expect(screen.getByText("Could not load your API keys")).toBeInTheDocument()
    );
    expect(screen.queryByText("No API keys yet")).toBeNull();
    expect(
      screen.getByText(/You do not have permission to view this organization's API keys/)
    ).toBeInTheDocument();
  });

  it("does not claim the org has no keys when the request throws", async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("offline"));

    render(<ApiKeysClient />);

    await waitFor(() =>
      expect(screen.getByText("Could not load your API keys")).toBeInTheDocument()
    );
    expect(screen.queryByText("No API keys yet")).toBeNull();
  });

  it("retries and shows the real list once the second attempt succeeds", async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("offline"));
    render(<ApiKeysClient />);
    await screen.findByText("Could not load your API keys");

    mockFetchOnce({
      ok: true,
      body: { keys: [{ id: "k1", name: "CI bot", createdAt: new Date().toISOString(), lastUsedAt: null }] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("CI bot")).toBeInTheDocument();
    expect(screen.queryByText("Could not load your API keys")).toBeNull();
  });
});
