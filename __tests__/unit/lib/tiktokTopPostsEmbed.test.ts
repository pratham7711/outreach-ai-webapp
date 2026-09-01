/**
 * The embed reader — the rung that finally covers a creator who never
 * connected their account.
 *
 * Two things are worth guarding hard. Authorship, because the sibling endpoint
 * /api/repost/item_list/ serves other people's videos from the same profile and
 * this codebase has already shipped that mistake once. And the bracket scan,
 * because captions are full of brackets and a lazy regex silently truncates the
 * list at the first one.
 */

import {
  parseTikTokEmbedVideoList,
  readTikTokTopPostsEmbed,
  tikTokEmbedUrl,
} from "@/lib/platforms/tiktokTopPostsEmbed";
import { TOP_POSTS_LIMIT } from "@/lib/platforms/creatorProfile";

const page = (videos: unknown[]) =>
  `<html><script>window.x={"videoList":${JSON.stringify(videos)},"other":1}</script></html>`;

const vid = (id: string, plays: number, author = "sonheii", extra: Record<string, unknown> = {}) => ({
  id,
  desc: `d${id}`,
  coverUrl: `https://cdn/${id}.jpg`,
  playCount: plays,
  authorUniqueId: author,
  ...extra,
});

describe("parsing", () => {
  it("reads the creator's videos out of the embed page", () => {
    const posts = parseTikTokEmbedVideoList(page([vid("1", 500)]), "sonheii");
    expect(posts).toEqual([
      {
        postId: "1",
        url: "https://www.tiktok.com/@sonheii/video/1",
        caption: "d1",
        coverUrl: "https://cdn/1.jpg",
        views: 500,
        likes: null,
        comments: null,
        postedAt: null,
      },
    ]);
  });

  it("drops videos authored by anyone else", () => {
    const posts = parseTikTokEmbedVideoList(
      page([vid("1", 10), vid("2", 99, "someone_else"), vid("3", 5)]),
      "sonheii"
    );
    expect(posts!.map((p) => p.postId)).toEqual(["1", "3"]);
  });

  it("drops a video with no author at all rather than assuming it is theirs", () => {
    const posts = parseTikTokEmbedVideoList(page([{ id: "1", playCount: 5 }]), "sonheii");
    expect(posts).toEqual([]);
  });

  it("matches the handle case-insensitively and ignores a leading @", () => {
    const posts = parseTikTokEmbedVideoList(page([vid("1", 5, "SonHeii")]), "@sonheii");
    expect(posts).toHaveLength(1);
  });

  it("survives brackets and quotes inside a caption", () => {
    const posts = parseTikTokEmbedVideoList(
      page([vid("1", 5, "sonheii", { desc: 'a [bracket] and a "quote" ]]' }), vid("2", 6)]),
      "sonheii"
    );
    expect(posts!.map((p) => p.postId)).toEqual(["1", "2"]);
  });

  it("returns null when the page carries no video list", () => {
    expect(parseTikTokEmbedVideoList("<html>nothing here</html>", "sonheii")).toBeNull();
  });

  it("returns null when the list is not parseable JSON", () => {
    expect(parseTikTokEmbedVideoList('x{"videoList":[{oops]}', "sonheii")).toBeNull();
  });

  it("keeps a missing cover or caption null", () => {
    const posts = parseTikTokEmbedVideoList(
      page([vid("1", 5, "sonheii", { desc: "", coverUrl: "" })]),
      "sonheii"
    );
    expect(posts![0].caption).toBeNull();
    expect(posts![0].coverUrl).toBeNull();
  });

  it("treats an absent play count as unknown, not zero", () => {
    const posts = parseTikTokEmbedVideoList(
      page([vid("1", 0, "sonheii", { playCount: null })]),
      "sonheii"
    );
    expect(posts![0].views).toBeNull();
  });
});

describe("reading", () => {
  it("ranks by views and caps at the display limit", async () => {
    const videos = Array.from({ length: 13 }, (_, i) => vid(String(i), i * 1000));
    const read = await readTikTokTopPostsEmbed("sonheii", async () => page(videos));
    expect(read!.topPosts).toHaveLength(TOP_POSTS_LIMIT);
    expect(read!.topPosts[0].postId).toBe("12");
  });

  it("averages across every video listed, not just the ranked ones", async () => {
    const read = await readTikTokTopPostsEmbed("sonheii", async () =>
      page([vid("a", 100), vid("b", 200), vid("c", 300)])
    );
    expect(read!.avgViews).toBe(200);
    expect(read!.sampledPosts).toBe(3);
  });

  it("returns null when the handle does not resolve", async () => {
    const read = await readTikTokTopPostsEmbed("nobody", async () => "<html>no list</html>");
    expect(read).toBeNull();
  });

  it("returns null when the page could not be fetched", async () => {
    expect(await readTikTokTopPostsEmbed("sonheii", async () => null)).toBeNull();
  });

  it("returns null rather than throwing when the fetch throws", async () => {
    const read = await readTikTokTopPostsEmbed("sonheii", async () => {
      throw new Error("egress refused");
    });
    expect(read).toBeNull();
  });

  it("returns null when every video belongs to someone else", async () => {
    const read = await readTikTokTopPostsEmbed("sonheii", async () =>
      page([vid("1", 10, "reposter")])
    );
    expect(read).toBeNull();
  });
});

it("builds the embed URL from a handle with or without an @", () => {
  expect(tikTokEmbedUrl("@sonheii")).toBe("https://www.tiktok.com/embed/@sonheii");
  expect(tikTokEmbedUrl("sonheii")).toBe("https://www.tiktok.com/embed/@sonheii");
});
