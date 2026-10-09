import {
  UNATTRIBUTED_CREATOR_NAMES,
  UNKNOWN_CREATOR_LABEL,
  isUnattributedCreator,
  unattributedCreatorName,
  unknownCreatorReason,
} from "@/lib/posts/unattributedName";
import { PLATFORM_VALUES } from "@/lib/platforms/constants";

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
    expect(unknownCreatorReason("INSTAGRAM")).toBe("Instagram won’t show us this post (private, trial reel or removed)");
    expect(unknownCreatorReason("YOUTUBE")).toBe("YouTube won’t say who posted this");
    expect(unknownCreatorReason(null)).toBe("The platform won’t say who posted this");
  });
});
