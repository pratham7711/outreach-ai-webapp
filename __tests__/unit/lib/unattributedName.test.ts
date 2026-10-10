/**
 * @jest-environment node
 */
import {
  UNATTRIBUTED_CREATOR_NAMES,
  UNATTRIBUTED_CREATOR_WHERE,
  UNKNOWN_CREATOR_LABEL,
  isUnattributedCreator,
  notPublicCreatorReason,
  unattributedCreatorName,
  unknownCreatorReason,
} from "@/lib/posts/unattributedName";
import { PLATFORM_VALUES } from "@/lib/platforms/constants";
import { creatorWhere, readCreatorFilters } from "@/lib/listFilters";

describe("unattributed holding row, recognised without the database", () => {
  /* The add route files any detected platform under a holding row, so a
     Facebook post nobody could place made "Unattributed Facebook posts" --
     which the four-platform list did not recognise. */
  it("recognises the holding row on every platform", () => {
    expect(UNATTRIBUTED_CREATOR_NAMES).toHaveLength(PLATFORM_VALUES.length);
    for (const platform of PLATFORM_VALUES) {
      expect(isUnattributedCreator({ handle: "", name: unattributedCreatorName(platform) })).toBe(true);
    }
    expect(isUnattributedCreator({ handle: "", name: "Unattributed Facebook posts" })).toBe(true);
  });

  it("needs the empty handle and the reserved name together", () => {
    expect(isUnattributedCreator({ handle: "someone", name: "Unattributed Instagram posts" })).toBe(false);
    expect(isUnattributedCreator({ handle: "", name: "A creator with no handle" })).toBe(false);
    expect(isUnattributedCreator({ handle: null, name: "Unattributed Instagram posts" })).toBe(true);
    expect(isUnattributedCreator(null)).toBe(false);
  });

  it("says why, in the words the add dialog and the report use", () => {
    expect(UNKNOWN_CREATOR_LABEL).toBe("Creator unknown");
    expect(unknownCreatorReason("INSTAGRAM")).toBe("Instagram isn’t showing who posted this yet");
    expect(unknownCreatorReason("YOUTUBE")).toBe("YouTube isn’t saying who posted this yet");
    expect(unknownCreatorReason(null)).toBe("The platform isn’t saying who posted this yet");
  });

  /* A post nobody outside can see will not name its owner, so "we check again"
     would promise something no check can deliver. */
  it("says the post is not public, without promising a retry, when the platform hides it", () => {
    expect(notPublicCreatorReason("INSTAGRAM")).toBe(
      "Instagram won’t show this post publicly: it was deleted, the account is private, or it is limited by region",
    );
    expect(notPublicCreatorReason(null)).toMatch(/^The platform won’t show this post publicly/);
    expect(notPublicCreatorReason("INSTAGRAM")).not.toMatch(/again|yet/);
  });

  /* The one cause an agency can act on, so it leads and says who acts -- but
     only as a possibility, since it looks the same as a private or deleted
     post from outside, and never on another platform or a removed post. */
  it("leads with the creator's age limit for an Instagram post that may be age-limited", () => {
    const reason = notPublicCreatorReason("INSTAGRAM", true);
    expect(reason).toBe(
      "Instagram hides this post from the public: the creator may have set an age limit, or it is private or deleted. Ask them to lift any age limit",
    );
    expect(reason).not.toMatch(/again|yet/);
    expect(notPublicCreatorReason("TIKTOK", true)).toBe(notPublicCreatorReason("TIKTOK"));
    expect(notPublicCreatorReason("INSTAGRAM", false)).toBe(notPublicCreatorReason("INSTAGRAM"));
  });
});

describe("the roster leaves the holding row out", () => {
  /* It showed on /creators as a creator called "Unattributed Instagram posts",
     and counted in the roster's total, its platform tabs and "select all". */
  it("excludes it from every roster query, filtered or not", () => {
    for (const sp of [{}, { q: "unattributed" }, { platform: "INSTAGRAM" }, { hasPosts: "1" }]) {
      for (const roster of [true, false]) {
        expect(creatorWhere("org-1", readCreatorFilters(sp), { roster }).AND).toContainEqual({ NOT: UNATTRIBUTED_CREATOR_WHERE });
      }
    }
  });

  it("matches on the empty handle and every reserved name", () => {
    expect(UNATTRIBUTED_CREATOR_WHERE).toEqual({ handle: "", name: { in: [...UNATTRIBUTED_CREATOR_NAMES] } });
  });
});
