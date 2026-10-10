/**
 * The post page is asked only when the embed would not name anybody, and the
 * answer files a post -- and pays a creator. So the failure that matters is a
 * wrong name, not a missing one: every shape below that is not exactly
 * owner/kind/this-shortcode must come back null.
 */
import { parseInstagramPostPageOwner, readInstagramPostPageOwner } from "@/lib/platforms/instagramPostPage";

const CODE = "DeKIkbgzlYq";

function page(ogUrl: string | null, { reversed = false } = {}) {
  const tag =
    ogUrl === null
      ? ""
      : reversed
        ? `<meta content="${ogUrl}" property="og:url" />`
        : `<meta property="og:url" content="${ogUrl}" />`;
  return `<!DOCTYPE html><html><head><title>Instagram</title>${tag}<meta property="og:type" content="article" /></head><body></body></html>`;
}

describe("parseInstagramPostPageOwner", () => {
  it("reads the owner out of og:url", () => {
    expect(parseInstagramPostPageOwner(page(`https://www.instagram.com/jane.doe_1/reel/${CODE}/`), CODE)).toBe("jane.doe_1");
    expect(parseInstagramPostPageOwner(page(`https://www.instagram.com/jane/p/${CODE}/`), CODE)).toBe("jane");
  });

  it("does not care which attribute comes first", () => {
    expect(parseInstagramPostPageOwner(page(`https://www.instagram.com/jane/reel/${CODE}/`, { reversed: true }), CODE)).toBe("jane");
  });

  it("names nobody on the shell a deleted, private or made-up post gets", () => {
    expect(parseInstagramPostPageOwner(page(null), CODE)).toBeNull();
  });

  it("refuses a page about some other post", () => {
    expect(parseInstagramPostPageOwner(page("https://www.instagram.com/jane/reel/DzzzzzzzzzA/"), CODE)).toBeNull();
  });

  it("refuses an og:url with no owner in it, rather than calling the owner 'reel'", () => {
    expect(parseInstagramPostPageOwner(page(`https://www.instagram.com/reel/${CODE}/`), CODE)).toBeNull();
  });

  it("refuses another host and a name Instagram would not allow", () => {
    expect(parseInstagramPostPageOwner(page(`https://evil.example/jane/reel/${CODE}/`), CODE)).toBeNull();
    expect(parseInstagramPostPageOwner(page(`https://www.instagram.com/jane%20doe/reel/${CODE}/`), CODE)).toBeNull();
    expect(parseInstagramPostPageOwner(page(`https://www.instagram.com/${"a".repeat(31)}/reel/${CODE}/`), CODE)).toBeNull();
  });
});

describe("readInstagramPostPageOwner", () => {
  const realFetch = global.fetch;
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  function html(body: string, ok = true) {
    return Promise.resolve({ ok, text: () => Promise.resolve(body) } as Response);
  }

  it("asks for the canonical post page as a bot, never as a browser", async () => {
    fetchMock.mockReturnValue(html(page(`https://www.instagram.com/jane/reel/${CODE}/`)));
    await expect(readInstagramPostPageOwner(`https://www.instagram.com/reel/${CODE}/?igsh=abc`)).resolves.toBe("jane");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://www.instagram.com/p/${CODE}/`);
    expect((init as RequestInit).headers).toMatchObject({ "user-agent": expect.stringMatching(/^MadeBoringBot\//) });
  });

  it("does not call out for a link with no shortcode", async () => {
    await expect(readInstagramPostPageOwner("https://www.instagram.com/jane/")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is null, not a throw, when the page will not load", async () => {
    fetchMock.mockReturnValueOnce(html("", false));
    await expect(readInstagramPostPageOwner(`https://www.instagram.com/p/${CODE}/`)).resolves.toBeNull();
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    await expect(readInstagramPostPageOwner(`https://www.instagram.com/p/${CODE}/`)).resolves.toBeNull();
  });
});
