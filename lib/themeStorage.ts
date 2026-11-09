/**
 * The saved theme choice, and the migration that runs before next-themes reads
 * it.
 *
 * "creatorcore" was a third theme until November 2026. next-themes applies
 * whatever string it finds under its key as a class on <html> -- it does not
 * check it against `themes` -- so a saved "creatorcore" would paint the bare
 * base palette, skip the color-scheme it sets for light and dark, and leave
 * every row of the theme menu unchecked. Rewriting the value to "light" before
 * next-themes' own boot script runs keeps the first paint, the color-scheme and
 * the menu on Light, with no flash and nothing for hydration to disagree with.
 *
 * A plain module, not part of ThemeChoices: that file is "use client", and a
 * string exported from it reaches a server component as a client reference,
 * not as the string.
 */

/** next-themes' default storage key, which app/layout.tsx leaves as is. */
export const THEME_STORAGE_KEY = "theme";

/** Saved values that are no longer themes, and the theme each one becomes. */
export const RETIRED_THEMES: Readonly<Record<string, string>> = { creatorcore: "light" };

/** Inline <head> script: runs before next-themes' script in <body>. */
export const THEME_MIGRATION_SCRIPT =
  `try{var k=${JSON.stringify(THEME_STORAGE_KEY)},m=${JSON.stringify(RETIRED_THEMES)},` +
  `v=localStorage.getItem(k);` +
  `if(v!==null&&Object.prototype.hasOwnProperty.call(m,v))localStorage.setItem(k,m[v])}catch(e){}`;
