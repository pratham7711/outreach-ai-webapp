import { fetchSoundStats } from "@/lib/platforms/tiktokSound";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe("fetchSoundStats", () => {
  const realFetch = global.fetch;
  const realKey = process.env.SCRAPECREATORS_API_KEY;

  afterEach(() => {
    global.fetch = realFetch;
    if (realKey === undefined) delete process.env.SCRAPECREATORS_API_KEY;
    else process.env.SCRAPECREATORS_API_KEY = realKey;
  });

  it("returns null when the provider key is unset (feature off)", async () => {
    delete process.env.SCRAPECREATORS_API_KEY;
    global.fetch = jest.fn();
    await expect(fetchSoundStats("7370375686554782506")).resolves.toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric clip id without calling the API", async () => {
    process.env.SCRAPECREATORS_API_KEY = "k";
    global.fetch = jest.fn();
    await expect(fetchSoundStats("not-an-id")).resolves.toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("reads the use count from a root video_count field", async () => {
    process.env.SCRAPECREATORS_API_KEY = "k";
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({ music: { video_count: 4210, title: "That's Who I Praise", author: "Brandon Lake", cover_large: "https://x/c.jpg" } }),
    );
    const stats = await fetchSoundStats("7370375686554782506");
    expect(stats).toEqual({
      usesCount: 4210,
      title: "That's Who I Praise",
      artist: "Brandon Lake",
      coverImageUrl: "https://x/c.jpg",
    });
  });

  it("falls back to a nested stats.userCount when video_count is absent", async () => {
    process.env.SCRAPECREATORS_API_KEY = "k";
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({ data: { stats: { userCount: 999 } } }),
    );
    const stats = await fetchSoundStats("123");
    expect(stats?.usesCount).toBe(999);
  });

  it("returns null on a non-ok response", async () => {
    process.env.SCRAPECREATORS_API_KEY = "k";
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({}, false, 429));
    await expect(fetchSoundStats("123")).resolves.toBeNull();
  });

  it("returns null when the request throws", async () => {
    process.env.SCRAPECREATORS_API_KEY = "k";
    global.fetch = jest.fn().mockRejectedValue(new Error("network"));
    await expect(fetchSoundStats("123")).resolves.toBeNull();
  });
});
