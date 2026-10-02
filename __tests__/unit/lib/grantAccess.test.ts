/**
 * @jest-environment node
 *
 * What the Access panel shows per platform: every live grant, or the latest
 * that ended, with a status the agency can act on.
 */
import { entriesToShow } from "@/lib/creators/grantAccess";
import type { GrantRecord } from "@/lib/creators/grants";

function grant(over: Partial<GrantRecord>): GrantRecord {
  return {
    id: "g-1",
    platform: "TIKTOK",
    connectionId: "conn-1",
    scopes: ["user.info.basic"],
    scopesSource: "provider",
    grantedAt: new Date("2026-09-01T00:00:00Z"),
    revokedAt: null,
    revokeReason: null,
    source: "connect-link",
    ...over,
  } as GrantRecord;
}

describe("entriesToShow", () => {
  it("shows a live grant on a live connection as active", () => {
    const [e] = entriesToShow([grant({})], new Set(["conn-1"]), new Set());
    expect(e).toMatchObject({ platform: "TIKTOK", status: "active", grantedAt: "2026-09-01T00:00:00.000Z", scopes: ["user.info.basic"] });
  });

  it("shows Reconnect needed for a live grant whose connection is marked", () => {
    const [e] = entriesToShow([grant({})], new Set(["conn-1"]), new Set(["conn-1"]));
    expect(e.status).toBe("reconnect_needed");
  });

  it("shows Reconnect needed, not Revoked, for a grant Google's invalid_grant ended", () => {
    const [e] = entriesToShow(
      [grant({ platform: "YOUTUBE", revokedAt: new Date(), revokeReason: "invalid_grant" })],
      new Set(["conn-1"]),
      new Set(),
    );
    expect(e.status).toBe("reconnect_needed");
  });

  it("shows the latest ended grant when none is live, so the platform does not vanish", () => {
    const entries = entriesToShow(
      [
        grant({ id: "g-new", revokedAt: new Date("2026-09-20T00:00:00Z"), revokeReason: "disconnect" }),
        grant({ id: "g-old", revokedAt: new Date("2026-09-10T00:00:00Z"), revokeReason: "superseded" }),
      ],
      new Set(),
      new Set(),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: "g-new", status: "revoked", revokeReason: "disconnect" });
  });

  it("hides superseded history behind a live grant", () => {
    const entries = entriesToShow(
      [grant({ id: "g-live" }), grant({ id: "g-old", revokedAt: new Date(), revokeReason: "superseded" })],
      new Set(["conn-1"]),
      new Set(),
    );
    expect(entries.map((e) => e.id)).toEqual(["g-live"]);
  });

  it("does not call a live grant on a deleted connection active", () => {
    const [e] = entriesToShow([grant({})], new Set(), new Set());
    expect(e).toMatchObject({ status: "revoked", revokeReason: "connection_removed" });
  });

  it("carries no connection or account id to the browser", () => {
    const [e] = entriesToShow([grant({})], new Set(["conn-1"]), new Set());
    expect(JSON.stringify(e)).not.toContain("conn-1");
  });
});
