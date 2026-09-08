/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from "@testing-library/react";

jest.mock("@pratham7711/ui", () => ({
  Alert: ({ children }: any) => <div role="alert">{children}</div>,
  Badge: ({ children }: any) => <span>{children}</span>,
  Card: ({ children }: any) => <div>{children}</div>,
  LoadingSpinner: () => <span />,
  Toggle: ({ checked, onChange, disabled }: any) => (
    <input
      type="checkbox"
      role="switch"
      aria-label="Audit log recording"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
    />
  ),
}), { virtual: true });

import AuditLogToggleCard from "@/app/(dashboard)/settings/billing/AuditLogToggleCard";

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ enabled: true }),
  }) as any;
});

describe("AuditLogToggleCard", () => {
  it("disables the switch and says why when the user cannot manage settings", async () => {
    render(<AuditLogToggleCard initialEnabled planName="pro" canManage={false} />);

    expect(await screen.findByRole("switch")).toBeDisabled();
    expect(screen.getByText("Only owners and admins can change this.")).toBeInTheDocument();
  });

  it("never PATCHes for a non-admin even if the switch is driven directly", async () => {
    render(<AuditLogToggleCard initialEnabled planName="pro" canManage={false} />);
    const toggle = await screen.findByRole("switch");

    fireEvent.click(toggle);

    const patches = (global.fetch as jest.Mock).mock.calls.filter(
      ([, init]) => init?.method === "PATCH"
    );
    expect(patches).toHaveLength(0);
  });

  it("leaves the switch usable for an admin", async () => {
    render(<AuditLogToggleCard initialEnabled planName="pro" canManage />);

    const toggle = await screen.findByRole("switch");
    expect(toggle).not.toBeDisabled();
    expect(screen.queryByText("Only owners and admins can change this.")).toBeNull();
  });
});
