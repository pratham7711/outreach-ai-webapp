import { joinNames } from "@/lib/onboarding/list";

/* The onboarding step naming which platforms refresh their own counts is the
   first sentence a new user reads about how tracking works. It used to be built
   with join(" and "), which was correct only while the answer was exactly two
   platforms -- and correcting TikTok's capability made it three. */
it("leaves a single name alone", () => {
  expect(joinNames(["TikTok"])).toBe("TikTok");
});

it("takes the conjunction bare for two", () => {
  expect(joinNames(["Instagram", "YouTube"])).toBe("Instagram and YouTube");
});

it("uses commas and one conjunction for three", () => {
  // The case that motivated this: not "Instagram and TikTok and YouTube".
  expect(joinNames(["Instagram", "TikTok", "YouTube"])).toBe(
    "Instagram, TikTok and YouTube",
  );
});

it("honours 'or' for the connect step, which offers a choice rather than a list", () => {
  expect(joinNames(["Instagram", "YouTube"], "or")).toBe("Instagram or YouTube");
  expect(joinNames(["Instagram", "TikTok", "YouTube"], "or")).toBe(
    "Instagram, TikTok or YouTube",
  );
});

it("returns nothing for an empty list", () => {
  /* The callers guard on length before interpolating, but an empty string is
     the only value that cannot produce "undefined counts refresh on their own"
     if one of them ever stops. */
  expect(joinNames([])).toBe("");
});
