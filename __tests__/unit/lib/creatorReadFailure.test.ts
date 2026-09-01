/**
 * Telling "this handle does not exist" apart from "the read produced nothing".
 *
 * Both were filed as "unreadable", so the Trackers page told the operator that
 * the platform had answered without follower counts. For @retard (YouTube knew
 * of no such channel) and @.olise.ftbl (TikTok statusCode 10221 — the handle had
 * become oliseftbl_) that was false, and it pointed at the wrong remedy: the fix
 * is editing the tracked handle, and no amount of waiting produces a reading.
 */
import {
  READ_FAILURE_COPY,
  moreSpecificFailure,
  type CreatorReadFailure,
} from "@/lib/platforms/creatorProfile";
import { parseTikTokProfileHtml } from "@/lib/platforms/tiktokProfile";

/** A rehydration blob carrying a status and no userInfo, as TikTok serves for
 *  a handle that no longer resolves. */
function blobWithStatus(statusCode: number): string {
  const payload = {
    __DEFAULT_SCOPE__: { "webapp.user-detail": { statusCode } },
  };
  return `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(
    payload
  )}</script>`;
}

describe("copy", () => {
  it("has copy for every failure reason", () => {
    const reasons: CreatorReadFailure[] = [
      "no-credentials",
      "unsupported-platform",
      "not-a-professional-account",
      "unreadable",
      "no-such-account",
      "rate-limited",
    ];
    for (const r of reasons) expect(READ_FAILURE_COPY[r]).toBeTruthy();
  });

  it("tells the operator that waiting will not fix a missing handle", () => {
    expect(READ_FAILURE_COPY["no-such-account"]).toMatch(/not fix it/i);
  });

  it("does not claim the platform withheld the counts", () => {
    // That is the "unreadable" claim, and it was the wrong one here.
    expect(READ_FAILURE_COPY["no-such-account"]).not.toMatch(/did not include/i);
  });
});

describe("TikTok's not-found statuses", () => {
  it.each([10221, 10202])("reports statusCode %i as no-such-account", (status) => {
    const res = parseTikTokProfileHtml(blobWithStatus(status));
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toBe("no-such-account");
  });

  it("still reports an unrecognised status as merely unreadable", () => {
    // We do not know that the account is gone, so we must not say so.
    const res = parseTikTokProfileHtml(blobWithStatus(10999));
    expect(res.ok === false && res.reason).toBe("unreadable");
  });

  it("a shell with no blob stays unreadable, not no-such-account", () => {
    // This is what TikTok serves a client it distrusts. The account may be fine.
    const res = parseTikTokProfileHtml("<html><body>nothing</body></html>");
    expect(res.ok === false && res.reason).toBe("unreadable");
  });
});

describe("moreSpecificFailure", () => {
  it("lets a later rung's no-such-account beat the first rung's unreadable", () => {
    // The exact .olise.ftbl shape: direct fetch got a WAF shell, the sandbox
    // learned the account was gone.
    expect(moreSpecificFailure("unreadable", "no-such-account")).toBe("no-such-account");
  });

  it("does not let a later unreadable erase what the first rung established", () => {
    expect(moreSpecificFailure("no-such-account", "unreadable")).toBe("no-such-account");
    expect(moreSpecificFailure("rate-limited", "unreadable")).toBe("rate-limited");
  });

  it("keeps the first reason when neither is more specific", () => {
    expect(moreSpecificFailure("rate-limited", "rate-limited")).toBe("rate-limited");
    expect(moreSpecificFailure("no-such-account", "not-a-professional-account")).toBe(
      "no-such-account"
    );
  });
});
