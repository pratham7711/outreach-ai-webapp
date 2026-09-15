import { resolveAuthorFromPlatform } from "@/lib/platforms/postAuthor";
import { fetchInstagramEmbedPost } from "@/lib/platforms/instagramEmbed";

jest.mock("@/lib/platforms/instagramEmbed", () => ({ fetchInstagramEmbedPost: jest.fn() }));
const embed = fetchInstagramEmbedPost as jest.MockedFunction<typeof fetchInstagramEmbedPost>;

/**
 * The whole point of this module is removing a question from the operator, so
 * the failure that matters is not "it returned nothing" -- that just puts the
 * question back -- but "it returned the wrong person", which files a post
 * against the wrong creator and pays the wrong creator.
 */
describe("resolveAuthorFromPlatform", () => {
  const fetchMock = jest.fn();
  const realFetch = global.fetch;

  beforeEach(() => {
    fetchMock.mockReset();
    embed.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  function oembed(body: unknown, ok = true) {
    return Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);
  }

  it("reads the channel handle and display name off YouTube's oembed", async () => {
    fetchMock.mockReturnValue(
      oembed({ author_name: "danikmma", author_url: "https://www.youtube.com/@danikmma_1" })
    );
    await expect(
      resolveAuthorFromPlatform("https://www.youtube.com/watch?v=abc12345678", "YOUTUBE")
    ).resolves.toEqual({ handle: "danikmma_1", name: "danikmma" });
  });

  it("asks oembed for the exact URL it was given", async () => {
    fetchMock.mockReturnValue(oembed({ author_url: "https://www.youtube.com/@x" }));
    await resolveAuthorFromPlatform("https://youtu.be/AbC-123_xy", "YOUTUBE");
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://www.youtube.com/oembed?url=https%3A%2F%2Fyoutu.be%2FAbC-123_xy&format=json"
    );
  });

  it("refuses a /channel/UC id, which would never match the same creator twice", async () => {
    fetchMock.mockReturnValue(
      oembed({ author_name: "Someone", author_url: "https://www.youtube.com/channel/UCq-Fj5jknLsUf-MWSy4_brA" })
    );
    await expect(
      resolveAuthorFromPlatform("https://www.youtube.com/watch?v=abc12345678", "YOUTUBE")
    ).resolves.toBeNull();
  });

  it("keeps the handle but drops an empty display name", async () => {
    fetchMock.mockReturnValue(oembed({ author_name: "   ", author_url: "https://www.youtube.com/@only_handle" }));
    await expect(
      resolveAuthorFromPlatform("https://www.youtube.com/shorts/abc12345678", "YOUTUBE")
    ).resolves.toEqual({ handle: "only_handle", name: null });
  });

  it("returns null on a private or deleted video rather than throwing", async () => {
    fetchMock.mockReturnValue(oembed({}, false));
    await expect(
      resolveAuthorFromPlatform("https://www.youtube.com/watch?v=abc12345678", "YOUTUBE")
    ).resolves.toBeNull();
  });

  it("returns null when the request fails, so the dialog just asks as before", async () => {
    fetchMock.mockRejectedValue(new Error("TimeoutError"));
    await expect(
      resolveAuthorFromPlatform("https://www.youtube.com/watch?v=abc12345678", "YOUTUBE")
    ).resolves.toBeNull();
  });

  it("takes Instagram's owner off the embed the metrics chain already reads", async () => {
    embed.mockResolvedValue({ authorHandle: "@iamswarat", likesHidden: false, copyrightBlocked: false } as never);
    await expect(
      resolveAuthorFromPlatform("https://www.instagram.com/reel/DcQFHR5pdYw/", "INSTAGRAM")
    ).resolves.toEqual({ handle: "iamswarat", name: null });
  });

  it("returns null for a deleted Instagram post, whose embed names nobody", async () => {
    embed.mockResolvedValue(null);
    await expect(
      resolveAuthorFromPlatform("https://www.instagram.com/reel/DbBr2C5TAxu/", "INSTAGRAM")
    ).resolves.toBeNull();
  });

  it("does not call out for a platform that cannot answer", async () => {
    await expect(resolveAuthorFromPlatform("https://example.com/x", null)).resolves.toBeNull();
    await expect(resolveAuthorFromPlatform("https://x.com/a/status/1", "TWITTER")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
  });
});
