/**
 * @jest-environment node
 *
 * The Add Post dialog's paste box. Every shape here came off a real paste that
 * an operator sent, and the back-to-back case is the one that shipped broken:
 * two links pasted with nothing between them read as one link whose URL was
 * both of them concatenated, and the dialog said "1 link found".
 */
import {
  parsePastedPostEntries,
  parsePastedPostUrls,
  postIdentityKey,
} from "@/lib/posts/pastedUrls";

const A = "https://www.tiktok.com/@reinex.one/video/7684142520015621384";
const B = "https://www.tiktok.com/@someoneelse/video/7672119178437889297";

describe("splitting a paste", () => {
  it.each([
    ["one per line", `${A}\n${B}`],
    ["CRLF line endings", `${A}\r\n${B}`],
    ["blank line between", `${A}\n\n${B}`],
    ["a single space", `${A} ${B}`],
    ["comma separated", `${A},${B}`],
    ["comma and a space", `${A}, ${B}`],
    ["bulleted", `- ${A}\n- ${B}`],
    ["numbered", `1. ${A}\n2. ${B}`],
    ["inside prose", `here they are: ${A} and also ${B}, thanks`],
    // The regression. Two copy-pastes with no Return in between.
    ["back to back, no separator at all", `${A}${B}`],
  ])("finds both links when %s", (_shape, text) => {
    expect(parsePastedPostUrls(text)).toEqual([A, B]);
  });

  it("keeps the order they were pasted in", () => {
    expect(parsePastedPostUrls(`${B}\n${A}`)).toEqual([B, A]);
  });

  it("ignores lines that are not links", () => {
    expect(parsePastedPostUrls(`week 3 deliverables\n${A}\nthanks!`)).toEqual([A]);
  });

  it("strips the punctuation prose leaves behind", () => {
    expect(parsePastedPostUrls(`(see ${A}).`)).toEqual([A]);
  });

  it("finds nothing in an empty box", () => {
    expect(parsePastedPostUrls("")).toEqual([]);
    expect(parsePastedPostUrls("   \n  ")).toEqual([]);
  });
});

describe("what counts as the same post", () => {
  it("reads TikTok's tracking parameters as the same video", () => {
    const shared = `${A}?is_from_webapp=1&sender_device=pc&web_id=7522952180069598734`;
    expect(postIdentityKey(shared)).toBe(postIdentityKey(A));
  });

  it("separates two different videos", () => {
    expect(postIdentityKey(A)).not.toBe(postIdentityKey(B));
  });

  it("falls back to the URL for a link no platform claims", () => {
    expect(postIdentityKey("https://example.com/a/b/")).toBe("https://example.com/a/b");
    expect(postIdentityKey("https://example.com/a/b?x=1#f")).toBe("https://example.com/a/b?x=1");
  });

  /* The query has to survive on an unrecognised platform: dropping it made
     every ?v= URL one post, which is how a YouTube link came back as a
     duplicate of a different YouTube video. */
  it("does not merge two pages that differ only in their query", () => {
    expect(postIdentityKey("https://example.com/watch?v=one")).not.toBe(
      postIdentityKey("https://example.com/watch?v=two")
    );
  });
});

describe("marking repeats", () => {
  it("flags the second copy, never the first", () => {
    const entries = parsePastedPostEntries(`${A}\n${B}\n${A}`);
    expect(entries.map((e) => e.duplicate)).toEqual([false, false, true]);
  });

  it("flags a repeat wearing different tracking parameters", () => {
    const entries = parsePastedPostEntries(`${A}\n${A}?is_from_webapp=1&web_id=752295218`);
    expect(entries).toHaveLength(2);
    expect(entries[1].duplicate).toBe(true);
  });

  /* The old parser dropped repeats silently, so ten pasted links became nine
     rows with nothing saying which one went. Keeping them is what lets the
     dialog show the repeat in red. */
  it("keeps the repeat as its own row rather than dropping it", () => {
    expect(parsePastedPostEntries(`${A}\n${A}`)).toHaveLength(2);
    expect(parsePastedPostUrls(`${A}\n${A}`)).toEqual([A]);
  });
});
