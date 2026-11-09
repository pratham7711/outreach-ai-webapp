"use client";

import React, { useCallback, useEffect, useId, useLayoutEffect, useRef } from "react";

/**
 * Focus and Escape for anything that sits over the page and takes the
 * keyboard with it: Modal and FilterDrawer.
 *
 * While `open` it remembers what had focus, moves focus inside the panel,
 * keeps Tab inside it, closes on Escape, and on close hands focus back. Every
 * open layer goes on one module-level stack, so with a drawer and a dialog
 * open together only the topmost answers Escape or traps Tab -- and not when
 * a control inside already used that Escape to close its own menu (it calls
 * preventDefault).
 *
 * The scroll lock is counted separately from the stack, so a layer that does
 * not lock never stops the next one from locking.
 */

export const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

const stack: string[] = [];
let locks = 0;
let lockedOverflow: string | null = null;

function lockScroll() {
  if (locks++ === 0) {
    lockedOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
}
function unlockScroll() {
  if (locks > 0 && --locks === 0) {
    document.body.style.overflow = lockedOverflow ?? "";
    lockedOverflow = null;
  }
}

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export type DialogFocusOptions = {
  open: boolean;
  panelRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  /** Where focus goes on open. Falls back to the panel itself. */
  initialFocus?: (panel: HTMLElement) => HTMLElement | null | undefined;
  /** Locks page scroll while open. */
  lockScroll?: boolean;
};

/** Returns the Tab trap; put it on the panel's onKeyDown. */
export function useDialogFocus({
  open,
  panelRef,
  onClose,
  initialFocus,
  lockScroll: lock = true,
}: DialogFocusOptions): (e: React.KeyboardEvent) => void {
  const id = useId();
  const returnFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const initialRef = useRef(initialFocus);
  useIsoLayoutEffect(() => {
    onCloseRef.current = onClose;
    initialRef.current = initialFocus;
  });

  useIsoLayoutEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement as HTMLElement | null;
    stack.push(id);
    if (lock) lockScroll();
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel || panel.contains(document.activeElement)) return;
      const target = initialRef.current?.(panel) ?? panel;
      target.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(frame);
      const at = stack.lastIndexOf(id);
      if (at >= 0) stack.splice(at, 1);
      if (lock) unlockScroll();
    };
  }, [open, id, lock]);

  /* Focus goes back from a passive cleanup, not the layout one above. React
     notes the focused element before a commit's DOM work and puts focus back
     on it afterwards, and layout cleanups run inside that window: focus handed
     back there was taken straight back to the control inside the closing
     panel -- which stays mounted (the drawer for good, the dialog for its exit)
     -- so Escape left focus in a hidden layer (MEASURED in jsdom, React 19:
     the trigger's focus() ran, then commitRoot refocused the panel's input). */
  useEffect(() => {
    if (!open) return;
    return () => {
      const back = returnFocus.current;
      if (back && document.contains(back)) back.focus({ preventScroll: true });
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || stack[stack.length - 1] !== id) return;
      e.stopPropagation();
      onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, id]);

  return useCallback(
    (e: React.KeyboardEvent) => {
      const panel = panelRef.current;
      if (e.key !== "Tab" || !panel || stack[stack.length - 1] !== id) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.closest("[aria-hidden='true']") && el.offsetParent !== null,
      );
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [id, panelRef],
  );
}
