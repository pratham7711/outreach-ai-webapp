/**
 * Join names the way a person writes them.
 *
 * `join(" and ")` was fine while exactly two platforms could collect metrics.
 * Correcting TikTok's capability made it three, and the onboarding step turned
 * into "Instagram and TikTok and YouTube counts refresh on their own" -- copy
 * that reads like a bug in the sentence a new user meets on their first screen.
 * One list is a name, two take the conjunction bare, three or more take commas
 * with the conjunction before the last.
 */
export function joinNames(names: string[], conjunction: "and" | "or" = "and"): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} ${conjunction} ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} ${conjunction} ${names[names.length - 1]}`;
}
