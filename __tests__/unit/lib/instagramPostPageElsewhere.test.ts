/**
 * The other-region read boots a sandbox per region for a post that looked gone
 * from here. What must hold: each sandbox is short-lived, never persistent and
 * always deleted; the request is the same honest bot read as at home; and a
 * region that could not answer is left out rather than reported as a verdict.
 */
jest.mock("@/lib/ops/sandboxBudget", () => ({ createSandbox: jest.fn() }));
jest.mock("@/lib/observability/logger", () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

import { createSandbox } from "@/lib/ops/sandboxBudget";
import { OTHER_REGIONS, readInstagramPostPageElsewhere } from "@/lib/platforms/instagramPostPageElsewhere";

const create = createSandbox as jest.MockedFunction<typeof createSandbox>;
const CODE = "DeKIkbgzlYq";

type Answer = { exitCode?: number; stdout: string } | Error;

function fakeSandbox(page: Answer, media: Answer) {
  const runCommand = jest.fn(async (_cmd: string, args: string[]) => {
    const answer = args.some((a) => a.includes("/media/")) ? media : page;
    if (answer instanceof Error) throw answer;
    return { exitCode: answer.exitCode ?? 0, stdout: async () => answer.stdout };
  });
  const del = jest.fn(async () => {});
  return { sandbox: { runCommand, delete: del }, runCommand, del };
}

beforeEach(() => create.mockReset());

it("asks Mumbai and Virginia, each from a short-lived sandbox that is never kept", async () => {
  const boxes = OTHER_REGIONS.map(() => fakeSandbox({ stdout: "<html>page</html>" }, { stdout: "302 https://scontent.cdninstagram.com/c.jpg" }));
  boxes.forEach((b) => create.mockResolvedValueOnce(b.sandbox as never));

  const out = await readInstagramPostPageElsewhere(CODE);

  expect(OTHER_REGIONS).toEqual(["bom1", "iad1"]);
  expect(create.mock.calls.map(([params]) => params.region)).toEqual(["bom1", "iad1"]);
  for (const [params, caller] of create.mock.calls) {
    expect(params).toMatchObject({ persistent: false, timeout: expect.any(Number) });
    expect(params.timeout).toBeLessThanOrEqual(5 * 60 * 1000);
    expect(caller).toBe("instagram-post-page");
  }
  for (const b of boxes) expect(b.del).toHaveBeenCalledWith({ deleteOrphanSnapshots: true });
  expect(out).toEqual([
    { region: "bom1", html: "<html>page</html>", mediaStatus: 302, mediaLocation: "https://scontent.cdninstagram.com/c.jpg" },
    { region: "iad1", html: "<html>page</html>", mediaStatus: 302, mediaLocation: "https://scontent.cdninstagram.com/c.jpg" },
  ]);
});

it("reads the canonical page and the thumbnail address as the bot, with no cookie, and does not follow the redirect", async () => {
  const b = fakeSandbox({ stdout: "<html/>" }, { stdout: "404 " });
  create.mockResolvedValue(b.sandbox as never);

  await readInstagramPostPageElsewhere(CODE);

  const calls = b.runCommand.mock.calls.map(([cmd, args]) => ({ cmd, args }));
  const pageCall = calls.find((c) => c.args.includes(`https://www.instagram.com/p/${CODE}/`))!;
  const mediaCall = calls.find((c) => c.args.includes(`https://www.instagram.com/p/${CODE}/media/?size=l`))!;
  for (const c of [pageCall, mediaCall]) {
    expect(c.cmd).toBe("curl");
    expect(c.args[c.args.indexOf("-A") + 1]).toMatch(/^MadeBoringBot\//);
    expect(c.args.join(" ")).not.toMatch(/cookie/i);
  }
  expect(mediaCall.args.some((a) => a.startsWith("-") && a.includes("L"))).toBe(false);
});

it("reports the thumbnail address's 404, and no answer at all as no status", async () => {
  create
    .mockResolvedValueOnce(fakeSandbox({ stdout: "<html/>" }, { stdout: "404 " }).sandbox as never)
    .mockResolvedValueOnce(fakeSandbox({ stdout: "<html/>" }, { stdout: "000 " }).sandbox as never);

  await expect(readInstagramPostPageElsewhere(CODE)).resolves.toEqual([
    { region: "bom1", html: "<html/>", mediaStatus: 404, mediaLocation: null },
    { region: "iad1", html: "<html/>", mediaStatus: null, mediaLocation: null },
  ]);
});

it("leaves out a region whose sandbox would not boot or whose page did not load -- and still deletes what it booted", async () => {
  const failedCurl = fakeSandbox({ exitCode: 28, stdout: "" }, { stdout: "000 " });
  create.mockRejectedValueOnce(new Error("sandbox cap")).mockResolvedValueOnce(failedCurl.sandbox as never);
  await expect(readInstagramPostPageElsewhere(CODE)).resolves.toEqual([]);
  expect(failedCurl.del).toHaveBeenCalled();

  const threw = fakeSandbox(new Error("command timed out"), { stdout: "404 " });
  create.mockReset();
  create.mockResolvedValue(threw.sandbox as never);
  await expect(readInstagramPostPageElsewhere(CODE)).resolves.toEqual([]);
  expect(threw.del).toHaveBeenCalledTimes(OTHER_REGIONS.length);
});
