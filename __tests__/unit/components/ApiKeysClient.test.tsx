/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

jest.mock("@/components/ds", () => ({
  PageHeader: ({ title }: any) => <h1>{title}</h1>,
}));

jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
let mockPayoutsOn = false;
jest.mock("@/lib/payouts/switch", () => ({
  get PAYOUTS_ENABLED() {
    return mockPayoutsOn;
  },
}));

/* The create and revoke dialogs are the library's Modal and Input now, and
   ds/Button wraps the library's Button. @pratham7711/ui's "exports" map has no
   `require` condition for jest's CJS resolver, so it is stubbed with just
   enough of each to keep the contract under test: a labelled input, and a
   dialog that exists only while open. */
jest.mock("@pratham7711/ui", () => ({
  Button: ({ children, loading: _loading, variant: _variant, size: _size, ...rest }: any) => (
    <button {...rest}>{children}</button>
  ),
  Input: ({ label, id, ...rest }: any) => (
    <>
      <label htmlFor={id}>{label}</label>
      <input id={id} {...rest} />
    </>
  ),
  Modal: ({ open, title, children, footer }: any) =>
    open ? (
      <div role="dialog" aria-label={title}>
        {children}
        {footer}
      </div>
    ) : null,
}), { virtual: true });

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
  mockPayoutsOn = false;
  global.fetch = jest.fn() as any;
});

describe("ApiKeysClient MCP description", () => {
  it("does not promise payouts while they are switched off (lib/payouts/switch.ts)", async () => {
    mockFetchOnce({ ok: true, body: { keys: [] } });
    render(<ApiKeysClient />);
    await screen.findByText("No API keys yet");
    expect(screen.getByText(/The MCP server gives an AI client read access/).textContent).toContain(
      "campaigns, posts, creators and activations, and lets it",
    );
    expect(document.body.textContent).not.toMatch(/payout/i);
  });

  it("lists payouts again once they are back on, as list_payouts is then offered", async () => {
    mockPayoutsOn = true;
    mockFetchOnce({ ok: true, body: { keys: [] } });
    render(<ApiKeysClient />);
    await screen.findByText("No API keys yet");
    expect(screen.getByText(/The MCP server gives an AI client read access/).textContent).toContain(
      "creators, activations and payouts, and lets it",
    );
  });
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

describe("ApiKeysClient create dialog", () => {
  it("is a named dialog whose field is labelled, and Enter in it creates the key", async () => {
    mockFetchOnce({ ok: true, body: { keys: [] } });
    render(<ApiKeysClient />);
    fireEvent.click(await screen.findByRole("button", { name: "Create your first key" }));

    expect(screen.getByRole("dialog", { name: "Create API Key" })).toBeInTheDocument();
    const field = screen.getByLabelText("Key name");

    mockFetchOnce({ ok: true, body: { key: "sk_test_once" } });
    mockFetchOnce({ ok: true, body: { keys: [] } });
    fireEvent.change(field, { target: { value: "CI bot" } });
    fireEvent.submit(field.closest("form") as HTMLFormElement);

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/keys",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "CI bot" }) })
      )
    );
  });

  it("does not submit an empty name", async () => {
    mockFetchOnce({ ok: true, body: { keys: [] } });
    render(<ApiKeysClient />);
    fireEvent.click(await screen.findByRole("button", { name: "Create your first key" }));

    fireEvent.submit(screen.getByLabelText("Key name").closest("form") as HTMLFormElement);

    expect((global.fetch as jest.Mock).mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Create Key" })).toBeDisabled();
  });
});
