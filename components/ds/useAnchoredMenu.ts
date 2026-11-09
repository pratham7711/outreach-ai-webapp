"use client";

import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from "react";

/**
 * Fixed coordinates for a menu portalled to <body>, taken off the control it
 * belongs to.
 *
 * Portalling is what keeps a menu whole: a card, a table cell and a dialog body
 * all set `overflow`, and a menu positioned inside one is cut at its edge (the
 * Merge dialog's results were cut off at the footer). This keeps the portalled menu
 * attached to its control while anything scrolls or the window resizes, opens
 * it below, flips it above when there is more room there, and holds it inside
 * the viewport. The menu's own size is watched too, so a list that grows after
 * a fetch is placed again.
 *
 * `fitContent` is for a menu whose width is its own (MoreMenu's actions), not
 * its control's: alignment and clamping then use the menu's measured width,
 * and the caller does not set `width` on it.
 */

const GAP = 4;
const MARGIN = 8;

export type AnchoredPos = { top: number; left: number; width: number };

export function useAnchoredMenu(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLElement | null>,
  {
    align = "left",
    minWidth = 0,
    estimateHeight = 220,
    fitContent = false,
  }: { align?: "left" | "right"; minWidth?: number; estimateHeight?: number; fitContent?: boolean } = {},
) {
  const [pos, setPos] = useState<AnchoredPos | null>(null);

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const menu = menuRef.current;
    const menuH = menu?.offsetHeight ?? estimateHeight;
    const width = Math.max(fitContent && menu ? menu.offsetWidth : r.width, minWidth);

    const below = window.innerHeight - r.bottom - MARGIN;
    const flip = below < menuH && r.top > below;
    const top = Math.max(MARGIN, flip ? r.top - menuH - GAP : r.bottom + GAP);

    let left = align === "right" ? r.right - width : r.left;
    left = Math.min(left, window.innerWidth - width - MARGIN);
    left = Math.max(MARGIN, left);

    setPos((p) => (p && p.top === top && p.left === left && p.width === width ? p : { top, left, width }));
  }, [anchorRef, menuRef, align, minWidth, estimateHeight, fitContent]);

  // Callers draw the menu only while `open`, so a position left over from the
  // last opening is never shown: this re-measures before the first paint.
  // Measuring layout and storing it is what useLayoutEffect is for; deferring
  // the setState (microtask, rAF) lets React render it after a paint, so the
  // menu would open one frame late.
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- layout measurement before paint
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    // Capture, so a scroll inside any ancestor (a dialog body, a table) moves
    // the menu with its control instead of stranding it.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  const placed = pos !== null;
  useEffect(() => {
    const menu = menuRef.current;
    if (!open || !placed || !menu || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => place());
    ro.observe(menu);
    return () => ro.disconnect();
  }, [open, placed, menuRef, place]);

  return { pos, place };
}
