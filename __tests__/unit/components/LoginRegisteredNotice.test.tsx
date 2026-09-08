/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";

jest.mock("@pratham7711/ui", () => ({
  Input: ({ label, value, onChange, type }: any) => (
    <input aria-label={label} value={value} onChange={onChange} type={type} />
  ),
}), { virtual: true });

/* The ds barrel re-exports @pratham7711/ui, so it comes apart once that is
   mocked. The notice under test is plain markup in the page itself. */
jest.mock("@/components/ds", () => ({
  Button: ({ children, ...rest }: any) => <button {...rest}>{children}</button>,
}));

jest.mock("framer-motion", () => ({
  motion: new Proxy({} as any, {
    get: () => ({ children, ...rest }: any) => <div {...rest}>{children}</div>,
  }),
}));

import LoginPage from "@/app/(auth)/login/page";

/**
 * /api/signup answers `verificationEmail: "sent" | "unavailable"` and the
 * signup page used to throw it away, redirecting to a bare `?registered=1`.
 * The login page then told everyone "we have emailed you a link" — including
 * accounts created on a deployment with no mail provider, who then went looking
 * through spam for a message that was never sent.
 */
function renderAt(search: string) {
  window.history.replaceState({}, "", `/login${search}`);
  return render(<LoginPage />);
}

describe("login page — account created notice", () => {
  it("promises an email only when one actually went out", () => {
    renderAt("?registered=1&verify=sent");
    expect(screen.getByRole("status")).toHaveTextContent(/we have emailed you a link/i);
  });

  it("says so plainly when the verification email could not be sent", () => {
    renderAt("?registered=1&verify=unavailable");
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent(/could not send the confirmation email/i);
    expect(notice).not.toHaveTextContent(/we have emailed you/i);
    // And points at the way back in, rather than leaving a dead end.
    expect(notice).toHaveTextContent(/Resend/i);
  });

  it("makes no claim at all on an older link with no verify param", () => {
    const notice = renderAt("?registered=1").getByRole("status");
    expect(notice).toHaveTextContent(/Account created/i);
    expect(notice).not.toHaveTextContent(/emailed/i);
    expect(notice).not.toHaveTextContent(/could not send/i);
  });

  it("shows nothing when the visitor did not just sign up", () => {
    renderAt("");
    expect(screen.queryByRole("status")).toBeNull();
  });
});
