/**
 * @jest-environment node
 */
const resolveAuthor = jest.fn();
jest.mock("@/lib/platforms/postAuthor", () => ({ resolveAuthorFromPlatform: (...a: unknown[]) => resolveAuthor(...a) }));

import { MAX_POST_LOOKUPS, resolvePostLinks } from "@/lib/creators/resolvePostLinks";
import type { ColumnMapping } from "@/lib/creators/importParse";

const MAPPING: ColumnMapping = ["name", "tiktokLink", "instagramLink", "youtubeLink"];
const fetchMock = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
});

const res = (over: { location?: string; ok?: boolean; json?: unknown }) => ({
  ok: over.ok ?? true,
  headers: { get: (h: string) => (h.toLowerCase() === "location" ? (over.location ?? null) : null) },
  json: async () => over.json,
});

describe("resolvePostLinks", () => {
  it("turns a reel and a Short into profile links and leaves real profiles alone", async () => {
    resolveAuthor.mockImplementation(async (url: string, platform: string) =>
      platform === "INSTAGRAM" ? { handle: "igorftbl10", name: null } : { handle: "NARA-n6f", name: null },
    );
    const rows = [
      ["Name", "TikTok", "Instagram", "YouTube"],
      ["A", "", "https://www.instagram.com/reel/DFtWWPmR6L6/?igsh=x", "https://youtube.com/shorts/Hn-wPfXYNso?si=y"],
      ["B", "https://www.tiktok.com/@keep", "https://www.instagram.com/stay/", "N/A"],
    ];
    const out = await resolvePostLinks(rows, MAPPING);
    expect(out.rows[1]).toEqual(["A", "", "https://www.instagram.com/igorftbl10/", "https://www.youtube.com/@NARA-n6f"]);
    expect(out.rows[2]).toEqual(rows[2]);
    expect(out.resolved).toEqual([
      { row: 2, platform: "INSTAGRAM", handle: "igorftbl10" },
      { row: 2, platform: "YOUTUBE", handle: "NARA-n6f" },
    ]);
    expect(rows[1][2]).toContain("/reel/");
    expect(resolveAuthor).toHaveBeenCalledTimes(2);
  });

  it("reads a TikTok share link's handle off the redirect", async () => {
    fetchMock.mockResolvedValueOnce(res({ location: "https://www.tiktok.com/@nath_lein?_r=1&_t=abc" }));
    const out = await resolvePostLinks([["Name", "TikTok"], ["A", "https://vt.tiktok.com/ZSC5wM2UU/"]], ["name", "tiktokLink"]);
    expect(out.rows[1][1]).toBe("https://www.tiktok.com/@nath_lein");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to oEmbed when the redirect hides the handle", async () => {
    fetchMock
      .mockResolvedValueOnce(res({ location: "https://www.tiktok.com/@/video/7506142887617285382?_r=1" }))
      .mockResolvedValueOnce(res({ json: { author_unique_id: "someone.real" } }));
    const out = await resolvePostLinks([["Name", "TikTok"], ["A", "https://vm.tiktok.com/ZMSqhowSF/"]], ["name", "tiktokLink"]);
    expect(out.rows[1][1]).toBe("https://www.tiktok.com/@someone.real");
    expect(String(fetchMock.mock.calls[1][0])).toContain("oembed?url=" + encodeURIComponent("https://www.tiktok.com/@/video/7506142887617285382?_r=1"));
  });

  it("leaves a link alone, and counts it, when the platform will not say", async () => {
    resolveAuthor.mockResolvedValue(null);
    fetchMock.mockRejectedValue(new Error("blocked"));
    const rows = [["Name", "TikTok", "Instagram"], ["A", "https://vm.tiktok.com/x/", "https://www.instagram.com/reel/gone/"]];
    const out = await resolvePostLinks(rows, ["name", "tiktokLink", "instagramLink"]);
    expect(out.rows).toEqual(rows);
    expect(out).toMatchObject({ resolved: [], unresolved: 2 });
  });

  it("detects the mapping when none is sent, and does nothing for a sheet with no link columns", async () => {
    resolveAuthor.mockResolvedValue({ handle: "found", name: null });
    const out = await resolvePostLinks([["Name", "Instagram Link"], ["A", "https://www.instagram.com/reel/abc/"]], undefined);
    expect(out.rows[1][1]).toBe("https://www.instagram.com/found/");
    const none = await resolvePostLinks([["Name"], ["A"]], ["name"]);
    expect(none).toEqual({ rows: [["Name"], ["A"]], resolved: [], unresolved: 0 });
  });

  it("caps the number of lookups per request", async () => {
    resolveAuthor.mockResolvedValue({ handle: "x", name: null });
    const rows = [["Name", "Instagram"], ...Array.from({ length: MAX_POST_LOOKUPS + 10 }, (_, i) => ["n", `https://www.instagram.com/reel/r${i}/`])];
    const out = await resolvePostLinks(rows, ["name", "instagramLink"]);
    expect(resolveAuthor).toHaveBeenCalledTimes(MAX_POST_LOOKUPS);
    expect(out.unresolved).toBe(10);
  });
});
