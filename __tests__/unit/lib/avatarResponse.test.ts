/**
 * @jest-environment node
 */
import { avatarMissMode, serveAvatar } from "@/lib/creators/avatarResponse";
import { creatorAvatarSrc } from "@/components/creators/CreatorAvatar";

const resize = jest.fn(async (buf: Buffer) => buf);

describe("serveAvatar on a miss", () => {
  it("answers 404 by default, as every existing caller expects", async () => {
    const res = await serveAvatar(null, 64, resize);
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=3600");
  });

  it("answers an empty 204 only when the URL asks with miss=empty", async () => {
    const res = await serveAvatar(null, 64, resize, avatarMissMode(new URLSearchParams("w=64&miss=empty")));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=3600");
  });

  it("ignores any other miss value", () => {
    expect(avatarMissMode(new URLSearchParams("miss=1"))).toBe("404");
    expect(avatarMissMode(new URLSearchParams(""))).toBe("404");
  });

  it("serves a stored picture the same way whichever mode was asked for", async () => {
    const stored = { data: new Uint8Array([1, 2, 3]), fetchedAt: null } as any;
    const res = await serveAvatar(stored, 64, resize, "empty");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/webp");
  });
});

describe("creatorAvatarSrc", () => {
  it("asks the signed-in route for the quiet miss", () => {
    expect(creatorAvatarSrc("c 1", "sm", "v2")).toBe("/api/creators/c%201/avatar?w=64&miss=empty&v=v2");
    expect(creatorAvatarSrc(null)).toBeUndefined();
  });
});
