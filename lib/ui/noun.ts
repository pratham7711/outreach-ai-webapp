/**
 * The word that goes after a count: noun(1, "creator") is "creator", anything
 * else "creators".
 *
 * A dozen screens wrote `{n} creators` and so said "1 creators" on every list,
 * campaign and song with exactly one of something. Only the word is returned,
 * because the number beside it is formatted differently from screen to screen
 * (full, compact, localised) and that is not this helper's business.
 */
export function noun(n: number | null | undefined, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}
