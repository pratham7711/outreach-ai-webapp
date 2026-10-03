"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Feedback for a client-side navigation that is still waiting on the server.
 *
 * The App Router keeps the old page on screen, URL included, until the next
 * page's RSC payload arrives. MEASURED 2026-10-03 on prod: a rail click to
 * Overview sat 20,243ms with the request pending and nothing on screen
 * changing, then committed on its own; the clicks either side committed in
 * 16-1070ms. To the person clicking, that is a dead link they fix by reloading.
 *
 * So: a bar at the top once a navigation has been waiting long enough to be
 * noticed, and past HARD_NAVIGATION_AFTER_MS the reload they would have done
 * by hand, done for them -- a full page load, which does not wait on the
 * stalled request.
 */

const NAVIGATE_EVENT = "cc:navigate";
const SHOW_AFTER_MS = 150;
export const HARD_NAVIGATION_AFTER_MS = 10_000;

type Pending = { href: string; from: string; shown: boolean };

function placeOf(url: URL | Location): string {
  return url.pathname + url.search;
}

/** Called by NavLink's onNavigate, i.e. only once the router has taken the click. */
export function announceNavigation(href: string) {
  window.dispatchEvent(new CustomEvent<string>(NAVIGATE_EVENT, { detail: href }));
}

function loadPage(href: string) {
  window.location.assign(href);
}

export function NavigationProgress({ hardNavigate = loadPage }: { hardNavigate?: (href: string) => void } = {}) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const here = search ? `${pathname}?${search}` : pathname;
  const [pending, setPending] = useState<Pending | null>(null);
  const timers = useRef<{ show?: number; hard?: number }>({});

  useEffect(() => {
    const t = timers.current;
    const onNavigate = (e: Event) => {
      const href = (e as CustomEvent<string>).detail;
      window.clearTimeout(t.show);
      window.clearTimeout(t.hard);
      const from = placeOf(window.location);
      /* A link to where you already are commits nothing new, so the URL test
         below could never pass and the fallback would reload a working page. */
      if (placeOf(new URL(href, window.location.href)) === from) {
        setPending(null);
        return;
      }
      setPending({ href, from, shown: false });
      t.show = window.setTimeout(() => {
        setPending((p) => (p && p.href === href ? { ...p, shown: true } : p));
      }, SHOW_AFTER_MS);
      t.hard = window.setTimeout(() => {
        if (placeOf(window.location) === from && document.visibilityState === "visible") {
          hardNavigate(href);
        }
      }, HARD_NAVIGATION_AFTER_MS);
    };
    window.addEventListener(NAVIGATE_EVENT, onNavigate);
    return () => {
      window.removeEventListener(NAVIGATE_EVENT, onNavigate);
      window.clearTimeout(t.show);
      window.clearTimeout(t.hard);
    };
  }, [hardNavigate]);

  /* Any commit ends the wait, including one the person made some other way
     (back button, a second click), so the fallback can never fire afterwards. */
  useEffect(() => {
    window.clearTimeout(timers.current.show);
    window.clearTimeout(timers.current.hard);
  }, [here]);

  if (!pending?.shown || pending.from !== here) return null;
  return <div className="cc-nav-progress" role="progressbar" aria-label="Loading page" />;
}
