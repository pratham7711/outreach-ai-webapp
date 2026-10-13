/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, within, act } from "@testing-library/react";

jest.mock(
  "@pratham7711/ui",
  () => ({
    Modal: ({ children, footer, title }: any) => (
      <div>
        <h2>{title}</h2>
        {children}
        {footer}
      </div>
    ),
    /* Mirrors the real Input's error contract. The stub used to drop `error`
       on the floor, so a field that states its own problem rendered nothing
       here and the payout assertions below could not see a message the app
       does show. */
    Input: ({ label, value, onChange, type, error, required }: any) => {
      const id = `mock-input-${label}`;
      return (
        <>
          <input
            aria-label={label}
            id={id}
            value={value}
            onChange={onChange}
            type={type}
            required={required}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${id}-error` : undefined}
          />
          {error && (
            <span id={`${id}-error`} role="alert">
              {error}
            </span>
          )}
        </>
      );
    },
    Badge: ({ children }: any) => <span>{children}</span>,
  }),
  { virtual: true }
);

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
}));

/* jest.setup's router has no refresh(), which the wizard calls after a create. */
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}));

import CampaignWizard from "@/components/modals/CampaignWizard";

function openWizard(props: { defaultCurrency?: string } = {}) {
  render(<CampaignWizard clients={[]} onClose={jest.fn()} {...props} />);
}
const create = () => screen.getByText("Create Campaign").closest("button")!;
const name = (value: string) => fireEvent.change(screen.getByLabelText("Campaign Name"), { target: { value } });

describe("CampaignWizard — currency", () => {
  /* The wizard hardcoded "USD", so an agency billing in INR corrected the
     currency on every single campaign it created. */
  it("opens on the org's own currency", () => {
    openWizard({ defaultCurrency: "INR" });
    expect(screen.getByLabelText("Currency")).toHaveValue("INR");
  });

  it("falls back to USD when the org currency is absent or not one we offer", () => {
    openWizard({ defaultCurrency: "XYZ" });
    expect(screen.getByLabelText("Currency")).toHaveValue("USD");
  });
});

/**
 * One step since October 2026: the payout step left with the payments surface.
 * The trap it had to avoid -- a hidden payout model defaulting to per-view,
 * which demands a rate and a cap, leaving Create Campaign disabled with no
 * field on screen to fix it -- is what these pin.
 */
describe("CampaignWizard — a single step with no payout", () => {
  it("has no Next and no payout fields", () => {
    openWizard();
    expect(screen.queryByText("Next")).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Payout model" })).toBeNull();
    expect(screen.queryByLabelText("Rate per 1K Views")).toBeNull();
    expect(screen.queryByLabelText("Cap Amount")).toBeNull();
    expect(screen.queryByText(/Step \d of/)).toBeNull();
  });

  it("holds Create Campaign only until the campaign has a name", () => {
    openWizard();
    expect(create()).toBeDisabled();
    name("Summer Drop");
    expect(create()).not.toBeDisabled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("creates a negotiated, budget-based campaign with the budget, currency and approval mode given", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "c-1" }) });
    (global as { fetch: unknown }).fetch = fetchMock;
    openWizard({ defaultCurrency: "INR" });
    name("Summer Drop");
    fireEvent.change(screen.getByLabelText("Budget"), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("radio", { name: /Auto-Approved/ }));
    await act(async () => {
      fireEvent.click(create());
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/campaigns");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      title: "Summer Drop",
      campaignType: "BUDGET_BASED",
      budget: 5000,
      currency: "INR",
      postApprovalMode: "AUTO_APPROVED",
      typeConfig: { model: "negotiated", currency: "INR", allowCounterOffer: true },
    });
  });

  /* "Who handles payment?" went earlier: payment is always self-managed, so
     the question offered a service we do not run. */
  it("does not ask who handles payment", () => {
    openWizard();
    expect(screen.queryByRole("radiogroup", { name: "Who handles payment?" })).toBeNull();
    expect(screen.queryByText("Payment Release Trigger")).toBeNull();
    expect(screen.queryByText(/open enrollment/i)).toBeNull();
  });
});

/**
 * The approval cards were bare <div onClick> -- role null, tabIndex -1, so the
 * mode could only be changed with a mouse. They now use the same radio group
 * the payout model used.
 */
describe("CampaignWizard — post approval mode is a radio group", () => {
  const group = () => screen.getByRole("radiogroup", { name: "Post approval mode" });
  const radios = () => within(group()).getAllByRole("radio");

  it("offers Manual Review and Auto-Approved, Manual checked", () => {
    openWizard();
    expect(radios().map((r) => [r.textContent?.startsWith("Manual") ? "manual" : "auto", r.getAttribute("aria-checked")])).toEqual([
      ["manual", "true"],
      ["auto", "false"],
    ]);
  });

  it("keeps one tab stop, on the selected card", () => {
    openWizard();
    const [first, second] = radios();
    expect(first).toHaveAttribute("tabindex", "0");
    expect(second).toHaveAttribute("tabindex", "-1");
  });

  it("selects with the keyboard and moves with the arrows", () => {
    openWizard();
    fireEvent.keyDown(radios()[1], { key: " " });
    expect(radios()[1]).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(radios()[1], { key: "ArrowLeft" });
    expect(radios()[0]).toHaveAttribute("aria-checked", "true");
  });
});

/**
 * Walkthrough 2026-10-13 A1#22: the Budget field took "-500" and the only
 * answer was the server's bare "Invalid input". It is refused beside the field
 * now, and 0 means "no budget", sent as null like an empty field.
 */
describe("CampaignWizard — budget", () => {
  const budget = (value: string) => fireEvent.change(screen.getByLabelText("Budget"), { target: { value } });

  it("refuses a negative budget beside the field and holds Create Campaign", () => {
    openWizard();
    name("Summer Drop");
    budget("-500");
    expect(screen.getByRole("alert")).toHaveTextContent("Budget can't be negative.");
    expect(create()).toBeDisabled();
    budget("500");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(create()).not.toBeDisabled();
  });

  it("sends a budget of 0 as no budget", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "c-1" }) });
    (global as { fetch: unknown }).fetch = fetchMock;
    openWizard();
    name("Summer Drop");
    budget("0");
    await act(async () => {
      fireEvent.click(create());
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).budget).toBeNull();
  });
});

/**
 * Walkthrough 2026-10-13 A1#11: Import on a TikTok link whose id TikTok does
 * not know showed a sound card titled from the URL slug ("WALK Test Sound").
 * The route now says whether the platform confirmed the sound, and an
 * unconfirmed one gets no card and no name.
 */
describe("CampaignWizard — importing a sound TikTok cannot confirm", () => {
  function importLink(response: Record<string, unknown>) {
    (global as { fetch: unknown }).fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => response });
    openWizard();
    fireEvent.click(screen.getByText("This campaign promotes a sound"));
    fireEvent.change(screen.getByLabelText("Sound link"), {
      target: { value: "https://www.tiktok.com/music/WALK-Test-Sound-7400000000000000009" },
    });
  }

  it("says it could not find or verify the sound and shows no made-up title", async () => {
    importLink({ platform: "TIKTOK", soundId: "7400000000000000009", verified: false, provisionalTitle: null });
    await act(async () => {
      fireEvent.click(screen.getByText("Import"));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't find or verify this sound on TikTok.");
    expect(screen.queryByText(/WALK Test Sound/)).toBeNull();
    expect(screen.queryByText(/^Sound 7400000000000000009$/)).toBeNull();
  });

  it("still shows the card for a sound TikTok answered for", async () => {
    importLink({
      platform: "TIKTOK",
      soundId: "7400000000000000009",
      verified: true,
      provisionalTitle: "Real Sound",
      artist: "Real Artist",
      coverImageUrl: "https://example.com/cover.jpg",
      usesCount: 12,
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Import"));
    });
    expect(screen.getByText("Real Sound")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
