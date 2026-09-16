/**
 * @jest-environment node
 *
 * The Add Post dialog holds each identified link as a chip rather than as a
 * line of text, so the links themselves are the state and the pasted blob is
 * not. These are the two pure pieces that makes possible: merging a paste into
 * the links already held, and what a chip says.
 */
import { mergePastedEntries, pastedUrlLabel, MAX_BULK_POSTS } from "@/lib/posts/pastedUrls";

const TT = "https://www.tiktok.com/@someone/video/7123456789012345678";
const TT_SHARED = `${TT}?is_from_webapp=1&sender_device=pc&web_id=7522952180069598734`;
const TT_OTHER = "https://www.tiktok.com/@another/video/7987654321098765432";
const IG = "https://www.instagram.com/reel/C8xYzAbCdEf/";
const YT = "https://youtube.com/watch?v=dQw4w9WgXcQ";

describe("mergePastedEntries", () => {
  it("appends a paste after the links already held, in that order", () => {
    expect(mergePastedEntries([TT], `${IG}\n${YT}`).map((e) => e.url)).toEqual([TT, IG, YT]);
  });

  it("marks a paste that repeats a link already held, rather than dropping it", () => {
    /* Dropping it silently is what the dialog must never do: an operator who
       pasted three and sees two has no way to tell which one went. */
    const merged = mergePastedEntries([TT], IG + "\n" + TT_SHARED);
    expect(merged.map((e) => e.duplicate)).toEqual([false, false, true]);
    expect(merged).toHaveLength(3);
  });

  it("re-derives duplicate across the whole list, so removing the first promotes the second", () => {
    /* This is the behaviour a chip needs and a derived-from-text list could not
       have: with the first copy gone, the survivor is no longer a repeat of
       anything and must be submittable. */
    const both = mergePastedEntries([], `${TT}\n${TT_SHARED}`);
    expect(both.map((e) => e.duplicate)).toEqual([false, true]);

    const afterRemovingTheFirst = mergePastedEntries([TT_SHARED], "");
    expect(afterRemovingTheFirst.map((e) => e.duplicate)).toEqual([false]);
  });

  it("truncates the combined list rather than displacing links already on screen", () => {
    const held = Array.from({ length: MAX_BULK_POSTS }, (_, i) =>
      `https://www.tiktok.com/@someone/video/71234567890123400${String(i).padStart(2, "0")}`
    );
    const merged = mergePastedEntries(held, TT_OTHER);
    expect(merged).toHaveLength(MAX_BULK_POSTS);
    expect(merged[0].url).toBe(held[0]);
    expect(merged.some((e) => e.url === TT_OTHER)).toBe(false);
  });

  it("returns the links untouched when the paste carries none", () => {
    expect(mergePastedEntries([TT], "just some prose").map((e) => e.url)).toEqual([TT]);
  });

  it("is empty for no links at all", () => {
    expect(mergePastedEntries([], "")).toEqual([]);
  });
});

describe("pastedUrlLabel", () => {
  it("names the handle and a short post id for a link that carries both", () => {
    expect(pastedUrlLabel(TT)).toBe("@someone · 71234…5678");
  });

  it("is unchanged by the tracking parameters the share sheet appends", () => {
    /* Two chips for the same post must not read as two different posts. */
    expect(pastedUrlLabel(TT_SHARED)).toBe(pastedUrlLabel(TT));
  });

  it("falls back to the post id where the link names nobody", () => {
    expect(pastedUrlLabel(IG)).toBe("C8xYzAbCdEf");
    expect(pastedUrlLabel(YT)).toBe("dQw4w9WgXcQ");
  });

  it("still identifies a link no detector claims", () => {
    expect(pastedUrlLabel("https://www.example.com/posts/hello-world")).toBe(
      "example.com/hello-world"
    );
  });

  it("never renders a label long enough to break the chip row", () => {
    const long = "https://example.com/" + "x".repeat(300);
    const label = pastedUrlLabel(long);
    expect(label.length).toBeLessThanOrEqual(40);
    expect(label.endsWith("…")).toBe(true);
  });

  it("does not throw on a string that is not a URL at all", () => {
    expect(() => pastedUrlLabel("not a url")).not.toThrow();
  });
});
