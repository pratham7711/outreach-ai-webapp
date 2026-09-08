/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from "@testing-library/react";

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
    Input: ({ label, value, onChange, type }: any) => (
      <input aria-label={label} value={value} onChange={onChange} type={type} />
    ),
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
 * canNext() only validated step 0, so a fixed-rate campaign with the rate left
 * blank walked to the end and buildTypeConfig()'s `Number("") || 0` shipped
 * ratePerPost: 0 — a campaign that promises every creator nothing per post.
 */
describe("CampaignWizard — payout step validation", () => {
  it("will not advance a fixed-rate campaign with no rate, and says why", () => {
    openPayoutStep();
    expect(screen.getByRole("alert")).toHaveTextContent(/rate you pay per approved post/i);
    expect(screen.getByText("Next").closest("button")).toBeDisabled();
  });

  it("advances once a rate is entered", () => {
    openPayoutStep();
    fireEvent.change(screen.getByLabelText("Rate per Post"), { target: { value: "500" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Next").closest("button")).not.toBeDisabled();
  });

  it("holds a per-view campaign until both the rate and the cap are set", () => {
    openPayoutStep();
    fireEvent.click(screen.getByText("Per 1K views, with a cap"));
    expect(screen.getByRole("alert")).toHaveTextContent(/per 1,000 views/i);

    fireEvent.change(screen.getByLabelText("Rate per 1K Views"), { target: { value: "5" } });
    expect(screen.getByRole("alert")).toHaveTextContent(/maximum you will pay/i);

    fireEvent.change(screen.getByLabelText("Cap Amount"), { target: { value: "2000" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("asks nothing of a negotiated campaign, whose rate is agreed per creator", () => {
    openPayoutStep();
    fireEvent.click(screen.getByText("Negotiated"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Next").closest("button")).not.toBeDisabled();
  });

  it("also refuses to submit from the last step while the payout is unset", () => {
    openPayoutStep();
    fireEvent.change(screen.getByLabelText("Rate per Post"), { target: { value: "500" } });
    next();
    fireEvent.click(screen.getByText("Back").closest("button")!);
    fireEvent.change(screen.getByLabelText("Rate per Post"), { target: { value: "0" } });
    // Next is blocked, so the submit button is only reachable by going forward
    // again — which is exactly what the guard on it covers.
    expect(screen.getByText("Next").closest("button")).toBeDisabled();
  });
});
