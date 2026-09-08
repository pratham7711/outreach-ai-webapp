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
