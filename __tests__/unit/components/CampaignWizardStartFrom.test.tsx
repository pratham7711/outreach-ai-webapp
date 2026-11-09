/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";

/* New Campaign's "Start from": Blank, a saved template, or a past campaign's
   setup. Picking one fills the fields a person can see -- client, budget,
   currency, approval, notes -- and the create names the source so the server
   copies the brief, rules and phases from its own copy. */

jest.mock(
  "@pratham7711/ui",
  () => ({
    Input: ({ label, value, onChange, onBlur, onPaste, placeholder, type, error, required }: any) => (
      <>
        <input
          aria-label={label}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          onPaste={onPaste}
          placeholder={placeholder}
          type={type}
          required={required}
        />
        {error && <span role="alert">{error}</span>}
      </>
    ),
    Badge: ({ children }: any) => <span>{children}</span>,
  }),
  { virtual: true }
);

const mockConfirm = jest.fn();
jest.mock("@/components/ds", () => ({
  Button: ({ children, loading, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled || loading}>
      {children}
    </button>
  ),
  Dropdown: ({ ariaLabel, value, onChange, options }: any) => (
    <select aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o: any) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
  useConfirm: () => mockConfirm,
}));

const mockToastError = jest.fn();
jest.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => mockToastError(...a), success: jest.fn() } }));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}));

type Sources = Record<string, unknown>;
let mockSources: Sources;
const mockRemove = jest.fn();
const mockRename = jest.fn();
const mockFetchSetupSource = jest.fn();
jest.mock("@/components/campaigns/templates/useStartFromSources", () => ({
  useStartFromSources: () => mockSources,
  fetchSetupSource: (...a: unknown[]) => mockFetchSetupSource(...a),
}));

import CampaignWizard from "@/components/modals/CampaignWizard";
import { resolveConfirm } from "@/components/ds/ConfirmDialog";

const TEMPLATE = {
  id: "tpl-1",
  name: "Song launch, three waves",
  description: null,
  updatedAt: "2026-11-01T00:00:00.000Z",
  summary: { client: true, budget: { amount: 8000, currency: "EUR" }, approval: "AUTO_APPROVED", notes: true, brief: true, rules: 3, phases: 2 },
  clientName: "Velvet Room Records",
};
const PAST = { id: "camp-sb", title: "Static Bloom", clientName: "Velvet Room Records", updatedAt: "2026-11-01T00:00:00.000Z" };

function sources(over: Partial<Sources> = {}): Sources {
  return {
    status: "ready",
    available: true,
    canManage: true,
    query: "",
    searching: false,
    templates: [TEMPLATE],
    campaigns: [PAST],
    campaignsMore: false,
    search: jest.fn(),
    rename: mockRename,
    remove: mockRemove,
    ...over,
  };
}

function templateSource(setup: Record<string, unknown> = {}) {
  return {
    ok: true,
    source: {
      kind: "template",
      id: "tpl-1",
      name: "Song launch, three waves",
      setup: {
        version: 1,
        clientId: "cl-velvet",
        budget: 8000,
        currency: "EUR",
        postApprovalMode: "AUTO_APPROVED",
        notes: "Pay on posting.",
        brief: "Hook in the first second.",
        rules: null,
        phases: [],
        ...setup,
      },
      summary: TEMPLATE.summary,
      alsoCopies: "the brief, 3 rules and 2 phases",
      clientName: "Velvet Room Records",
      canSave: true,
    },
  };
}

const CLIENTS = [
  { id: "cl-velvet", name: "Velvet Room Records" },
  { id: "cl-kite", name: "Kiteline Records" },
];

function openWizard(clients = CLIENTS) {
  render(<CampaignWizard clients={clients} onClose={jest.fn()} defaultCurrency="USD" />);
}
const trigger = () => screen.getByRole("button", { name: /Start from/ });
const create = () => screen.getByText("Create Campaign").closest("button")!;
const notes = () => screen.getByLabelText("Notes") as HTMLTextAreaElement;

async function pickTemplate() {
  fireEvent.click(trigger());
  await act(async () => {
    fireEvent.click(screen.getByText("Song launch, three waves"));
  });
}

beforeEach(() => {
  mockSources = sources();
  mockConfirm.mockReset();
  mockRemove.mockReset();
  mockRename.mockReset();
  mockFetchSetupSource.mockReset();
  mockToastError.mockReset();
});

describe("CampaignWizard — Start from", () => {
  it("is not there when the org has no templates and no other campaigns", () => {
    mockSources = sources({ available: false, templates: [], campaigns: [] });
    openWizard();
    expect(screen.queryByTestId("start-from")).toBeNull();
    expect(screen.getByLabelText("Campaign Name")).toBeInTheDocument();
  });

  it("only holds its space while the list loads: hidden, inert and out of the accessibility tree", () => {
    mockSources = sources({ status: "loading" });
    openWizard();
    expect(screen.queryByTestId("start-from")).toBeNull();
    expect(screen.queryByRole("button", { name: /Start from/ })).toBeNull();
    const held = screen.getByText("Start from").closest(".ui-input-root") as HTMLElement;
    expect(held).toHaveAttribute("aria-hidden", "true");
    expect(held).toHaveAttribute("inert");
    expect(held.style.visibility).toBe("hidden");
  });

  it("is not there when the list could not be read", () => {
    mockSources = sources({ status: "error" });
    openWizard();
    expect(screen.queryByTestId("start-from")).toBeNull();
    expect(screen.queryByText("Start from")).toBeNull();
  });

  it("starts on Blank and lists the templates and past campaigns when opened", () => {
    openWizard();
    expect(trigger()).toHaveTextContent("Blank");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger());
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("start-from-template")).toHaveTextContent("Song launch, three waves");
    expect(screen.getByTestId("start-from-campaign")).toHaveTextContent("Static Bloom");
  });

  it("fills the visible fields from a template, names what else it copies, and leaves the name alone", async () => {
    mockFetchSetupSource.mockResolvedValue(templateSource());
    openWizard();
    fireEvent.change(screen.getByLabelText("Campaign Name"), { target: { value: "Midnight Static" } });
    await pickTemplate();

    expect(mockFetchSetupSource).toHaveBeenCalledWith("template", "tpl-1");
    expect(screen.getByLabelText("Campaign Name")).toHaveValue("Midnight Static");
    expect(screen.getByLabelText("Client")).toHaveValue("cl-velvet");
    expect(screen.getByLabelText("Budget")).toHaveValue(8000);
    expect(screen.getByLabelText("Currency")).toHaveValue("EUR");
    expect(screen.getByRole("radio", { name: /Auto-Approved/ })).toHaveAttribute("aria-checked", "true");
    expect(notes().value).toBe("Pay on posting.");
    expect(trigger()).toHaveTextContent("Song launch, three waves");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Fills in the fields below and also copies the brief, 3 rules and 2 phases. Never creators, posts or links.",
    );
  });

  it("names the source in the create and sends the fields as they stand, edits included", async () => {
    mockFetchSetupSource.mockResolvedValue(templateSource());
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "c-9" }) });
    (global as { fetch: unknown }).fetch = fetchMock;
    openWizard();
    fireEvent.change(screen.getByLabelText("Campaign Name"), { target: { value: "Midnight Static" } });
    await pickTemplate();
    fireEvent.change(screen.getByLabelText("Budget"), { target: { value: "9500" } });

    await act(async () => {
      fireEvent.click(create());
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/campaigns");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      title: "Midnight Static",
      clientId: "cl-velvet",
      budget: 9500,
      currency: "EUR",
      postApprovalMode: "AUTO_APPROVED",
      notes: "Pay on posting.",
      setupFrom: { kind: "template", id: "tpl-1" },
    });
    /* The brief, rules and phases are never sent from the browser: the
       server reads them from the source itself. */
    expect(body).not.toHaveProperty("brief");
    expect(body).not.toHaveProperty("rules");
    expect(body).not.toHaveProperty("phases");
  });

  it("does not offer a client that is no longer the org's", async () => {
    mockFetchSetupSource.mockResolvedValue(templateSource({ clientId: "cl-gone" }));
    openWizard();
    await pickTemplate();
    expect(screen.getByLabelText("Client")).toHaveValue("");
  });

  it("copies a past campaign's setup the same way", async () => {
    mockFetchSetupSource.mockResolvedValue({
      ok: true,
      source: { ...templateSource().source, kind: "campaign", id: "camp-sb", name: "Static Bloom", alsoCopies: null },
    });
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "c-9" }) });
    (global as { fetch: unknown }).fetch = fetchMock;
    openWizard();
    fireEvent.click(trigger());
    await act(async () => {
      fireEvent.click(screen.getByText("Static Bloom"));
    });
    expect(mockFetchSetupSource).toHaveBeenCalledWith("campaign", "camp-sb");
    expect(trigger()).toHaveTextContent("Copy of a past campaign");
    expect(screen.getByRole("status")).toHaveTextContent("Fills in the fields below. Never creators, posts or links.");

    fireEvent.change(screen.getByLabelText("Campaign Name"), { target: { value: "Static Bloom II" } });
    await act(async () => {
      fireEvent.click(create());
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).setupFrom).toEqual({ kind: "campaign", id: "camp-sb" });
  });

  it("goes back to Blank: the filled fields clear and the create names no source", async () => {
    mockFetchSetupSource.mockResolvedValue(templateSource());
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "c-9" }) });
    (global as { fetch: unknown }).fetch = fetchMock;
    openWizard();
    await pickTemplate();
    fireEvent.click(screen.getByRole("button", { name: "Back to Blank" }));

    expect(trigger()).toHaveTextContent("Blank");
    expect(screen.getByLabelText("Client")).toHaveValue("");
    expect(screen.getByLabelText("Budget")).toHaveValue(null);
    expect(screen.queryByLabelText("Currency")).toBeNull();
    expect(screen.getByRole("radio", { name: /Manual/ })).toHaveAttribute("aria-checked", "true");
    expect(notes().value).toBe("");

    fireEvent.change(screen.getByLabelText("Campaign Name"), { target: { value: "Fresh" } });
    await act(async () => {
      fireEvent.click(create());
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty("setupFrom");
  });

  it("says so when the setup could not be read, and stays on Blank", async () => {
    mockFetchSetupSource.mockResolvedValue({ ok: false, error: "Template not found" });
    openWizard();
    await pickTemplate();
    expect(trigger()).toHaveTextContent("Blank");
    expect(screen.getByRole("status")).toHaveTextContent("Template not found");
    expect(screen.getByLabelText("Budget")).toHaveValue(null);
  });

  it("holds Create while the setup is being read", async () => {
    let answer: (v: unknown) => void = () => {};
    mockFetchSetupSource.mockReturnValue(new Promise((r) => (answer = r)));
    openWizard();
    fireEvent.change(screen.getByLabelText("Campaign Name"), { target: { value: "Midnight Static" } });
    fireEvent.click(trigger());
    fireEvent.click(screen.getByText("Song launch, three waves"));
    expect(create()).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Reading its setup");
    await act(async () => {
      answer(templateSource());
    });
    expect(create()).not.toBeDisabled();
  });

  it("deletes a template only once the delete is confirmed", async () => {
    mockRemove.mockResolvedValue({ ok: true });
    openWizard();
    fireEvent.click(trigger());

    mockConfirm.mockResolvedValueOnce(false);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete Song launch, three waves" }));
    });
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ verb: "delete", subject: "Song launch, three waves", confirmLabel: "Delete template" }),
    );
    expect(resolveConfirm(mockConfirm.mock.calls[0][0])).toEqual(
      expect.objectContaining({ title: 'Delete "Song launch, three waves"?', danger: true }),
    );
    expect(mockRemove).not.toHaveBeenCalled();

    mockConfirm.mockResolvedValueOnce(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete Song launch, three waves" }));
    });
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith("tpl-1"));
  });

  it("renames a template in place", async () => {
    mockRename.mockResolvedValue({ ok: true });
    openWizard();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("button", { name: "Rename Song launch, three waves" }));
    fireEvent.change(screen.getByLabelText("New name for Song launch, three waves"), { target: { value: "Three waves" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    });
    expect(mockRename).toHaveBeenCalledWith("tpl-1", "Three waves");
  });

  it("offers no rename or delete to someone who cannot create campaigns", () => {
    mockSources = sources({ canManage: false });
    openWizard();
    fireEvent.click(trigger());
    expect(screen.queryByRole("button", { name: /Delete Song launch/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Rename Song launch/ })).toBeNull();
  });
});
