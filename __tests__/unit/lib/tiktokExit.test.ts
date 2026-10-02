/**
 * @jest-environment node
 */
const create = jest.fn();
jest.mock("@vercel/sandbox", () => ({ Sandbox: { create: (...a: unknown[]) => create(...a) } }));

import { httpWorkerExit, isTikTokPageUrl, sandboxExit, splitCurlOutput } from "@/lib/platforms/tiktokExit";

describe("isTikTokPageUrl", () => {
  it("allows only https tiktok.com pages", () => {
    expect(isTikTokPageUrl("https://www.tiktok.com/@someone")).toBe(true);
    expect(isTikTokPageUrl("https://tiktok.com/embed/@someone")).toBe(true);
    expect(isTikTokPageUrl("http://www.tiktok.com/@someone")).toBe(false);
    expect(isTikTokPageUrl("https://www.tiktok.com.evil.example/@x")).toBe(false);
    expect(isTikTokPageUrl("https://example.com/?u=https://www.tiktok.com/")).toBe(false);
    expect(isTikTokPageUrl("not a url")).toBe(false);
  });
});

describe("splitCurlOutput", () => {
  it("separates the page from the status curl appended", () => {
    expect(splitCurlOutput("<html>x</html>\n__EXIT_META__ 200")).toEqual({ body: "<html>x</html>", status: 200 });
  });
  it("reports status 0 when curl wrote no status line", () => {
    expect(splitCurlOutput("<html>")).toEqual({ body: "<html>", status: 0 });
  });
});

describe("sandboxExit (Plan A)", () => {
  beforeEach(() => create.mockReset());

  it("boots once, non-persistent, one vCPU, with the lifetime it is given", async () => {
    const runCommand = jest.fn().mockResolvedValue({ stdout: async () => "<html>page</html>\n__EXIT_META__ 200" });
    const del = jest.fn().mockResolvedValue(undefined);
    create.mockResolvedValue({ runCommand, delete: del });
    const exit = sandboxExit({ region: "iad1", lifetimeMs: 330_000, label: "A:iad1:0#1" });

    const a = await exit.fetchPage("https://www.tiktok.com/@one");
    const b = await exit.fetchPage("https://www.tiktok.com/@two");
    expect(a).toMatchObject({ status: 200, body: "<html>page</html>" });
    expect(b?.status).toBe(200);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({ region: "iad1", timeout: 330_000, persistent: false, resources: { vcpus: 1 } });
    const args: string[] = runCommand.mock.calls[0][1];
    expect(args).toContain("--compressed");

    await exit.close();
    expect(del).toHaveBeenCalledWith({ deleteOrphanSnapshots: true });
  });

  it("answers null -- an exit failure, not TikTok's verdict -- when the sandbox cannot boot", async () => {
    create.mockRejectedValue(new Error("quota"));
    const exit = sandboxExit({ region: "iad1", lifetimeMs: 1000, label: "x" });
    await expect(exit.fetchPage("https://www.tiktok.com/@one")).resolves.toBeNull();
  });

  it("never fetches a non-TikTok URL", async () => {
    const exit = sandboxExit({ region: "iad1", lifetimeMs: 1000, label: "x" });
    await expect(exit.fetchPage("https://example.com/")).resolves.toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
});

describe("httpWorkerExit (Plan B)", () => {
  const page = (status: number, body: unknown) =>
    ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

  it("posts the URL with the bearer token and returns the worker's page", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(page(200, { status: 200, body: "<html>p</html>" }));
    const exit = httpWorkerExit({ baseUrl: "https://worker.example/", token: "t0k", label: "B:worker", fetchImpl });
    const got = await exit.fetchPage("https://www.tiktok.com/@one");
    expect(got).toMatchObject({ status: 200, body: "<html>p</html>" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://worker.example/fetch");
    expect(init.headers.authorization).toBe("Bearer t0k");
    expect(JSON.parse(init.body)).toEqual({ url: "https://www.tiktok.com/@one" });
  });

  it("treats a worker error, a bad shape or a network failure as an exit failure", async () => {
    for (const impl of [
      jest.fn().mockResolvedValue(page(502, { error: "upstream" })),
      jest.fn().mockResolvedValue(page(200, { status: "x" })),
      jest.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    ]) {
      const exit = httpWorkerExit({ baseUrl: "https://w.example", token: "t", label: "B", fetchImpl: impl });
      await expect(exit.fetchPage("https://www.tiktok.com/@one")).resolves.toBeNull();
    }
  });

  it("passes TikTok's own status through: a 403 page is an answer from TikTok, not a worker failure", async () => {
    const exit = httpWorkerExit({
      baseUrl: "https://w.example",
      token: "t",
      label: "B",
      fetchImpl: jest.fn().mockResolvedValue(page(200, { status: 403, body: "denied" })),
    });
    await expect(exit.fetchPage("https://www.tiktok.com/@one")).resolves.toMatchObject({ status: 403 });
  });
});
