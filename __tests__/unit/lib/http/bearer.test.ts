/**
 * @jest-environment node
 */
import { bearerMatches } from "@/lib/http/bearer";

describe("bearerMatches", () => {
  it("matches exactly `Bearer <secret>`", () => {
    expect(bearerMatches("Bearer s3cret", "s3cret")).toBe(true);
  });

  it("rejects a wrong secret of the same length", () => {
    expect(bearerMatches("Bearer s3creT", "s3cret")).toBe(false);
  });

  it("rejects a different length without throwing", () => {
    expect(bearerMatches("Bearer s3cret-and-more", "s3cret")).toBe(false);
    expect(bearerMatches("Bearer s3", "s3cret")).toBe(false);
  });

  it("rejects the secret without the Bearer prefix", () => {
    expect(bearerMatches("s3cret", "s3cret")).toBe(false);
  });

  it("never matches when the secret is unset or empty -- not even an empty header", () => {
    expect(bearerMatches("Bearer undefined", undefined)).toBe(false);
    expect(bearerMatches("Bearer ", "")).toBe(false);
    expect(bearerMatches("Bearer null", null)).toBe(false);
  });

  it("never matches a missing header", () => {
    expect(bearerMatches(null, "s3cret")).toBe(false);
    expect(bearerMatches(undefined, "s3cret")).toBe(false);
    expect(bearerMatches("", "s3cret")).toBe(false);
  });

  it("compares bytes, so a multi-byte secret matches only itself", () => {
    expect(bearerMatches("Bearer pässword", "pässword")).toBe(true);
    expect(bearerMatches("Bearer passwordd", "pässword")).toBe(false);
  });
});
