/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from "@testing-library/react";

jest.mock(
  "@pratham7711/ui",
  () => ({
    Button: ({ children, onClick, disabled, iconLeft }: any) => (
      <button onClick={onClick} disabled={disabled}>
        {iconLeft}
        {children}
      </button>
    ),
  }),
  { virtual: true }
);

import { LoadError } from "@/components/ds/LoadError";

/**
 * The three surfaces this replaces all showed a failure as an absence:
 * /discovery span its skeletons for ever, /calendar said "Nothing scheduled",
 * and the audit log said "No audit events". None of them gave the reader a
 * reason to retry or report anything.
 */
describe("LoadError", () => {
  it("announces itself as an error rather than as content", () => {
    render(<LoadError onRetry={jest.fn()} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("offers a retry and calls it", () => {
    const onRetry = jest.fn();
    render(<LoadError onRetry={onRetry} />);
    fireEvent.click(screen.getByText("Try again"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("says what failed when the caller names it", () => {
    render(
      <LoadError
        title="We couldn't load this month"
        description="September 2026 could not be read."
        onRetry={jest.fn()}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't load this month");
    expect(screen.getByRole("alert")).toHaveTextContent("September 2026 could not be read.");
  });

  it("never claims there is no data — that is the empty state's job", () => {
    render(<LoadError onRetry={jest.fn()} />);
    const text = screen.getByRole("alert").textContent ?? "";
    expect(text).not.toMatch(/\bno (events|campaigns|creators|results)\b/i);
    expect(text).not.toMatch(/nothing (scheduled|here yet)/i);
  });

  it("disables the retry while one is already running", () => {
    render(<LoadError onRetry={jest.fn()} retrying />);
    expect(screen.getByText("Try again").closest("button")).toBeDisabled();
  });
});
