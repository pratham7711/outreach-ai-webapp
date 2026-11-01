/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import SharedPostList from "@/app/(public)/share/[token]/SharedPostList";

jest.mock("@/lib/postMedia", () => ({
  shareImgSrc: (_t: string, url: string | null) => (url ? "/img/proxied" : null),
}));

function row(i: number, over: Record<string, unknown> = {}) {
  return {
    id: `p${i}`,
    platform: i % 2 ? "TIKTOK" : "INSTAGRAM",
    postUrl: `https://www.tiktok.com/@c${i}/video/${i}`,
    thumbnailUrl: null,
    caption: `caption ${i}`,
    postedAt: new Date(Date.UTC(2026, 9, 1 + i)).toISOString(),
    lastSyncedAt: null,
    views: 1000 * i,
    likes: i === 3 ? null : 10 * i,
    comments: 1,
    shares: null,
    saves: null,
    downloads: null,
    engagementRate: 0.05,
    removed: false,
    creator: { id: `c${i}`, name: `Creator ${i}`, handle: `@c${i}`, avatarUrl: null },
    ...over,
  } as any;
}

const many = Array.from({ length: 30 }, (_, i) => row(i + 1));

describe("share report post tools", () => {
  it("stays out of the way on a short list", () => {
    render(<SharedPostList posts={many.slice(0, 5)} token="tok" showCreators />);
    expect(screen.queryByTestId("share-post-tools")).toBeNull();
  });

  it("pages a long list, 25 cards at a time, most views first", () => {
    const { container } = render(<SharedPostList posts={many} token="tok" showCreators />);
    expect(screen.getByText("1–25 of 30")).toBeInTheDocument();
    const cards = container.querySelectorAll(".spr-post");
    expect(cards).toHaveLength(25);
    expect(within(cards[0] as HTMLElement).getByText(/30,000 views/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(container.querySelectorAll(".spr-post")).toHaveLength(5);
  });

  it("finds a creator by name, and only by caption when creators are hidden", () => {
    const { container, unmount } = render(<SharedPostList posts={many} token="tok" showCreators />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Creator 12" } });
    expect(container.querySelectorAll(".spr-post")).toHaveLength(1);
    unmount();

    const hidden = many.map((p) => ({ ...p, creator: null, postUrl: null }));
    const second = render(<SharedPostList posts={hidden} token="tok" showCreators={false} />);
    expect(screen.getByRole("searchbox")).toHaveAttribute("placeholder", "Search captions");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "caption 7" } });
    expect(second.container.querySelectorAll(".spr-post")).toHaveLength(1);
  });

  it("sorts an unread count to the bottom, and shows it as a dash in the table", () => {
    render(<SharedPostList posts={many.slice(0, 12)} token="tok" showCreators />);
    fireEvent.change(screen.getByRole("combobox", { name: "Sort posts" }), { target: { value: "likes" } });
    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("Creator 12 (@c12)")).toBeInTheDocument();
    const last = rows[rows.length - 1];
    expect(within(last).getByText(/Creator 3/)).toBeInTheDocument();
    expect(within(last).getAllByText("—").length).toBeGreaterThan(0);
  });

  it("filters by platform", () => {
    const { container } = render(<SharedPostList posts={many} token="tok" showCreators />);
    fireEvent.change(screen.getByRole("combobox", { name: "Platform" }), { target: { value: "INSTAGRAM" } });
    expect(screen.getByText("1–15 of 15")).toBeInTheDocument();
    expect(container.querySelectorAll(".spr-post")).toHaveLength(15);
  });
});
