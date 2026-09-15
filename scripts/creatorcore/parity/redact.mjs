/**
 * Replaces identifying text in-page, BEFORE the screenshot.
 *
 * docs/CREATORCORE_UI_INVENTORY.md is gitignored for a stated reason -- it
 * "carries real creator handles and reference-org campaign names" -- and a
 * screenshot carries strictly more than the inventory does. These are real
 * creators' handles, so they are masked even though the account is ours.
 *
 * Replacements preserve character count and character class, so advance widths
 * barely move and the screenshot stays usable AS A LAYOUT REFERENCE, which is
 * its whole purpose. A redaction that reflows the page is worse than none.
 */
export const REDACT_SCRIPT = () => {
  const keepShape = (s, alphaFill) =>
    s.replace(/[A-Za-z]/g, alphaFill).replace(/[0-9]/g, "0");

  const RULES = [
    // @handle -> @aaaaaaa
    [/@[A-Za-z0-9._]{2,}/g, (m) => "@" + "a".repeat(m.length - 1)],
    // money -> $00,000.00
    [/\$\s?[\d,]+(\.\d+)?/g, (m) => m.replace(/\d/g, "0")],
    // emails
    [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (m) => keepShape(m, "a")],
  ];

  let changed = 0;
  if (!document.body) throw new Error("no document.body -- page is mid-navigation");
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  for (const node of nodes) {
    const before = node.textContent;
    let after = before;
    for (const [re, fn] of RULES) after = after.replace(re, fn);
    if (after !== before) {
      node.textContent = after;
      changed++;
    }
  }

  // Avatars and post thumbnails are photographs of real people. Keep the BOX
  // (layout depends on it) and drop only the pixels.
  let images = 0;
  for (const img of document.querySelectorAll("img")) {
    const r = img.getBoundingClientRect();
    if (r.width === 0) continue;
    img.style.filter = "blur(8px) grayscale(1)";
    images++;
  }
  for (const el of document.querySelectorAll("*")) {
    const bg = getComputedStyle(el).backgroundImage;
    if (bg && bg !== "none" && /url\(/.test(bg) && !/gradient/.test(bg)) {
      el.style.filter = "blur(8px) grayscale(1)";
      images++;
    }
  }
  return { textNodes: changed, images };
};
