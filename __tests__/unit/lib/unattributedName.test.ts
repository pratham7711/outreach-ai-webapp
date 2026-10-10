/**
 * @jest-environment node
 */
import {
  UNATTRIBUTED_CREATOR_NAMES,
  UNATTRIBUTED_CREATOR_WHERE,
  UNKNOWN_CREATOR_LABEL,
  isUnattributedCreator,
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
