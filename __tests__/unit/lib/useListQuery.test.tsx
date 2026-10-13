/**
 * @jest-environment jsdom
 */
import { Suspense, use, useState } from "react";
import { act, render, screen } from "@testing-library/react";
import { pendingListProps, useListQuery } from "@/lib/useListQuery";

const replace = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/campaigns",
}));

/* Stands in for the App Router: replace() moves the URL inside the caller's
   transition, and the next page suspends until its data "arrives" -- which is
   what keeps a real navigation pending while the server renders. */
let arrive: () => void = () => {};
function freshNavigation() {
  return new Promise<void>((resolve) => {
    arrive = resolve;
  });
}

function List({ status, wait }: { status: string; wait: Promise<void> | null }) {
  if (wait) use(wait);
  const { push, pending, shown } = useListQuery({ status, page: undefined });
  return (
    <div>
      <span data-testid="server">{status}</span>
      <span data-testid="shown">{String(shown.status)}</span>
      <span data-testid="page">{String(shown.page)}</span>
      <span data-testid="pending">{String(pending)}</span>
      <button onClick={() => push({ status: "COMPLETE", page: null })}>Complete</button>
    </div>
  );
}

/** `answer` overrides what the server renders, as when it normalises a value. */
function Harness({ answer }: { answer?: string }) {
  const [nav, setNav] = useState<{ status: string; wait: Promise<void> | null }>({ status: "ALL", wait: null });
  replace.mockImplementation((href: string) => {
    const asked = new URL(href, "http://x").searchParams.get("status") ?? "";
    setNav({ status: answer ?? asked, wait: freshNavigation() });
  });
  return (
    <Suspense fallback={<span>fallback</span>}>
      <List status={nav.status} wait={nav.wait} />
    </Suspense>
  );
}

describe("useListQuery", () => {
  beforeEach(() => replace.mockReset());

  it("requests exactly the URL it always did", async () => {
    render(<Harness />);
    await act(async () => screen.getByText("Complete").click());
    expect(replace).toHaveBeenCalledWith("/campaigns?status=COMPLETE", { scroll: false });
  });

  it("shows the choice while the server is still answering, then the server's own value", async () => {
    render(<Harness />);
    await act(async () => screen.getByText("Complete").click());

    // Still on the old page: the server value has not moved, the control has.
    expect(screen.getByTestId("server").textContent).toBe("ALL");
    expect(screen.getByTestId("shown").textContent).toBe("COMPLETE");
    expect(screen.getByTestId("page").textContent).toBe("null");
    expect(screen.getByTestId("pending").textContent).toBe("true");

    await act(async () => arrive());

    expect(screen.getByTestId("server").textContent).toBe("COMPLETE");
    expect(screen.getByTestId("shown").textContent).toBe("COMPLETE");
    expect(screen.getByTestId("pending").textContent).toBe("false");
    expect(screen.queryByText("fallback")).toBeNull();
  });

  it("drops the choice once the page lands, so the server's value wins", async () => {
    render(<Harness answer="IN_PROGRESS" />);
    await act(async () => screen.getByText("Complete").click());
    expect(screen.getByTestId("shown").textContent).toBe("COMPLETE");

    await act(async () => arrive());

    expect(screen.getByTestId("server").textContent).toBe("IN_PROGRESS");
    expect(screen.getByTestId("shown").textContent).toBe("IN_PROGRESS");
  });
});

describe("pendingListProps", () => {
  it("marks the list busy and dims it only while pending", () => {
    expect(pendingListProps(true)).toMatchObject({ "aria-busy": true, style: { opacity: 0.55 } });
    expect(pendingListProps(false)).toEqual({});
  });
});
