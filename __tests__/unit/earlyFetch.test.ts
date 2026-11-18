import { startFetch, takeFetch } from "@/lib/http/earlyFetch";

describe("earlyFetch", () => {
  const calls: string[] = [];
  beforeEach(() => {
    calls.length = 0;
    global.fetch = jest.fn((url: string) => {
      calls.push(url);
      return Promise.resolve({ json: async () => ({ url }) } as unknown as Response);
    }) as unknown as typeof fetch;
  });

  it("hands a started request to the first reader without fetching again", async () => {
    startFetch("/a");
    const res = await takeFetch("/a");
    expect(await res.json()).toEqual({ url: "/a" });
    expect(calls).toEqual(["/a"]);
  });

  it("gives the second reader a fresh request, since a body reads once", async () => {
    startFetch("/b");
    await takeFetch("/b");
    await takeFetch("/b");
    expect(calls).toEqual(["/b", "/b"]);
  });

  it("does not start the same URL twice while one is waiting", () => {
    startFetch("/c");
    startFetch("/c");
    expect(calls).toEqual(["/c"]);
  });

  it("fetches directly when nothing was started", async () => {
    await takeFetch("/d");
    expect(calls).toEqual(["/d"]);
  });

  it("drops a started request nobody took in time", async () => {
    const now = jest.spyOn(Date, "now");
    now.mockReturnValue(1_000);
    startFetch("/e");
    now.mockReturnValue(1_000 + 16_000);
    await takeFetch("/e");
    expect(calls).toEqual(["/e", "/e"]);
    now.mockRestore();
  });
});
