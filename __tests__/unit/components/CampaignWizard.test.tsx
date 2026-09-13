/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, within } from "@testing-library/react";

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

import CampaignWizard from "@/components/modals/CampaignWizard";

const next = () => fireEvent.click(screen.getByText("Next").closest("button")!);

function openPayoutStep(props: { defaultCurrency?: string } = {}) {
  render(<CampaignWizard clients={[]} onClose={jest.fn()} {...props} />);
  fireEvent.change(screen.getByLabelText("Campaign Name"), { target: { value: "Summer Drop" } });
  next();
}

describe("CampaignWizard — currency", () => {
  /* The wizard hardcoded "USD", so an agency billing in INR corrected the
     currency on every single campaign it created. */
  it("opens on the org's own currency", () => {
    openPayoutStep({ defaultCurrency: "INR" });
    expect(screen.getByLabelText("Currency")).toHaveValue("INR");
  });

  it("falls back to USD when the org currency is absent or not one we offer", () => {
    openPayoutStep({ defaultCurrency: "XYZ" });
    expect(screen.getByLabelText("Currency")).toHaveValue("USD");
  });
});

/**
 * canNext() only validated step 0, so a campaign with its rate left blank
 * walked to the end and buildTypeConfig()'s `Number("") || 0` shipped a zero —
 * a campaign that promises every creator nothing.
 *
 * Per-view opens the step now: "Fixed rate per post" was removed along with
 * the rest of the payment surface we do not run.
 */
describe("CampaignWizard — payout step validation", () => {
  it("offers no fixed rate per post, and no base rate on a negotiated campaign", () => {
    openPayoutStep();
    expect(screen.queryByText("Fixed rate per post")).toBeNull();
    expect(screen.queryByLabelText("Rate per Post")).toBeNull();
    fireEvent.click(screen.getByText("Negotiated"));
    expect(screen.queryByLabelText("Base Rate (optional)")).toBeNull();
  });

  it("holds a per-view campaign until both the rate and the cap are set", () => {
    openPayoutStep();
    /* Both empty fields name themselves at once. They used to share a single
       message that only ever named the first, so satisfying the field it asked
       about produced a second refusal that looked identical to the one just
       cleared. */
    expect(screen.getAllByRole("alert").map((el) => el.textContent)).toEqual([
      "Enter the rate you pay per 1,000 views.",
      "Enter the maximum you will pay a creator.",
    ]);

    fireEvent.change(screen.getByLabelText("Rate per 1K Views"), { target: { value: "5" } });
    expect(screen.getByRole("alert")).toHaveTextContent(/maximum you will pay/i);

    fireEvent.change(screen.getByLabelText("Cap Amount"), { target: { value: "2000" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("asks nothing of a negotiated campaign, whose rate is agreed per creator", () => {
    openPayoutStep();
    fireEvent.click(screen.getByText("Negotiated"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Create Campaign").closest("button")).not.toBeDisabled();
  });

  it("blocks Create Campaign, the last step's button, on the same rule", () => {
    openPayoutStep();
    // Payout is the last step now, so the submit button is on screen while the
    // per-view rate and cap are still empty. It must be held too.
    expect(screen.queryByText("Next")).toBeNull();
    expect(screen.getByText("Create Campaign").closest("button")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Rate per 1K Views"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Cap Amount"), { target: { value: "2000" } });
    expect(screen.getByText("Create Campaign").closest("button")).not.toBeDisabled();
  });
});

/**
 * The payout cards were bare <div onClick>. Measured on prod 2026-09-11: role
 * null, tabIndex -1, no aria-checked -- and eighteen Tab presses on the payout
 * step never landed on one, so the model could only be changed with a mouse.
 * The default was still reachable, which is why the flow looked fine.
 */
describe("CampaignWizard — payout model is a radio group", () => {
  const group = () => screen.getByRole("radiogroup", { name: "Payout model" });
  const radios = () => within(group()).getAllByRole("radio");

  it("offers the two remaining models as radios, exactly one of them checked", () => {
    openPayoutStep();
    expect(radios()).toHaveLength(2);
    expect(radios().filter((r) => r.getAttribute("aria-checked") === "true")).toHaveLength(1);
  });

  it("keeps one tab stop, on the selected card", () => {
    openPayoutStep();
    const [first, second] = radios();
    expect(first).toHaveAttribute("aria-checked", "true");
    expect(first).toHaveAttribute("tabindex", "0");
    expect(second).toHaveAttribute("tabindex", "-1");
  });

  it("selects with the keyboard, which a div onClick could not do", () => {
    openPayoutStep();
    expect(screen.getByText("Create Campaign").closest("button")).toBeDisabled();
    fireEvent.keyDown(radios()[1], { key: " " });
    expect(radios()[1]).toHaveAttribute("aria-checked", "true");
    /* Negotiated agrees its rate per creator, so nothing is left to fill in and
       the step stops blocking -- reached here without a mouse. */
    expect(screen.getByText("Create Campaign").closest("button")).not.toBeDisabled();
  });

  it("moves between the options with the arrow keys", () => {
    openPayoutStep();
    fireEvent.keyDown(radios()[0], { key: "ArrowDown" });
    expect(radios()[1]).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(radios()[1], { key: "ArrowUp" });
    expect(radios()[0]).toHaveAttribute("aria-checked", "true");
  });

  /* "Who handles payment?" is gone: payment is always self-managed, so the
     question offered a service we do not run. */
  it("does not ask who handles payment", () => {
    openPayoutStep();
    expect(screen.queryByRole("radiogroup", { name: "Who handles payment?" })).toBeNull();
    expect(screen.queryByText("Payment Release Trigger")).toBeNull();
    expect(screen.queryByText(/open enrollment/i)).toBeNull();
  });
});
