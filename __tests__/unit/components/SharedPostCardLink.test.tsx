/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import SharedPostList from "@/app/(public)/share/[token]/SharedPostList";

/* The image proxy signs its URLs, which needs a server. The grid only cares
   that it got a string back. */
jest.mock("@/lib/postMedia", () => ({
  shareImgSrc: (_t: string, url: string | null) => (url ? "/img/proxied" : null),
}));

/**
 * A brand reading the report clicks the thumbnail, not the handle.
 *
 * Only the handle was a link, so the rest of the card -- the artwork and every
 * counter, which is most of its area -- swallowed the click. The fix stretches
 * that same anchor over the card rather than wrapping the card in a second one,
 * so what these assert is that there is still exactly ONE link per card and it
 * still names the handle: a wrapping link would pass "the card is clickable"
 * while announcing every metric on it as the link's name.
 */
const basePost = {
  id: "p1",
  platform: "TIKTOK",
  postUrl: "https://www.tiktok.com/@someone/video/7123456789012345678",
  thumbnailUrl: "https://cdn.example/thumb.jpg",
  caption: "A caption",
  postedAt: new Date("2026-03-01T00:00:00Z").toISOString(),
  lastSyncedAt: new Date("2026-03-02T00:00:00Z").toISOString(),
  views: 55364,
  likes: 1204,
  comments: null,
  shares: null,
  saves: null,
  downloads: null,
  engagementRate: null,
  removed: false,
  creator: { id: "c1", name: "Someone", handle: "@someone", platform: "TIKTOK", avatarUrl: null },
} as any;

function renderGrid(posts: any[], showCreators = true) {
  return render(<SharedPostList posts={posts} token="tok" showCreators={showCreators} />);
}

describe("shared report post card — the whole card opens the post", () => {
  it("stretches the handle link across the card", () => {
    const { container } = renderGrid([basePost]);
    const link = screen.getByRole("link", { name: "@someone" });

    expect(link.className).toContain("spr-post-hit");
    expect(link).toHaveAttribute("href", basePost.postUrl);
    // A shared report is read beside the brand's other tabs; taking the tab
    // over is what the handle link already avoided.
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));

    // The overlay is the anchor's own pseudo-element, so the card must be the
    // positioned ancestor it resolves against -- that is what the stylesheet
    // puts on .spr-post, and what makes the stretch cover the card and not the
    // viewport.
    expect(container.querySelector(".spr-post")).toContainElement(link);
  });

  it("keeps one link and one accessible name per card", () => {
    renderGrid([basePost, { ...basePost, id: "p2", creator: { ...basePost.creator, handle: "@other" } }]);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links.map((l) => l.textContent)).toEqual(["@someone", "@other"]);
    // Not "@someone 55,364 views 1,204 likes Posted ... Last updated ...",
    // which is what wrapping the card in an anchor would have produced.
    expect(links[0].textContent).not.toMatch(/views/);
  });

  it("leaves a card with no post URL unlinked rather than making it a dead hit area", () => {
    renderGrid([{ ...basePost, postUrl: null }]);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});
