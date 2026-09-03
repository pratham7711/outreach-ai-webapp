import { parsePastedPostUrls } from "@/lib/posts/pastedUrls";

const TT = "https://www.tiktok.com/@someone/video/7123456789012345678";
const IG = "https://www.instagram.com/reel/C8xYzAbCdEf/";
const YT = "https://youtube.com/watch?v=dQw4w9WgXcQ";

describe("parsePastedPostUrls", () => {
  it("reads a newline-separated batch, which is how links arrive", () => {
    expect(parsePastedPostUrls(`${TT}\n${IG}\n${YT}`)).toEqual([TT, IG, YT]);
  });

  it("accepts commas and stray whitespace as separators too", () => {
    expect(parsePastedPostUrls(`  ${TT} ,   ${IG}\n\n\t${YT}  `)).toEqual([TT, IG, YT]);
  });

  it("de-duplicates, so a doubled paste does not create the post twice", () => {
    expect(parsePastedPostUrls(`${TT}\n${TT}\n${IG}`)).toEqual([TT, IG]);
  });

  it("ignores prose around the links", () => {
    // Operators paste the message they were sent, not a clean list.
    const blob = `hey here are this week's:\n1. ${TT}\n2. ${IG}\nthanks!`;
    expect(parsePastedPostUrls(blob)).toEqual([TT, IG]);
  });

  it("strips trailing punctuation a sentence leaves on a link", () => {
    expect(parsePastedPostUrls(`see ${TT}, and ${IG}.`)).toEqual([TT, IG]);
  });

  it("keeps only http(s) — a bare handle is not a post link", () => {
    expect(parsePastedPostUrls(`@someone\nnot-a-url\n${TT}`)).toEqual([TT]);
  });

  it("returns nothing for empty or link-free input", () => {
    expect(parsePastedPostUrls("")).toEqual([]);
    expect(parsePastedPostUrls("no links here at all")).toEqual([]);
  });

  it("preserves paste order, so the list matches what was pasted", () => {
    expect(parsePastedPostUrls(`${YT}\n${TT}\n${IG}`)).toEqual([YT, TT, IG]);
  });
});
