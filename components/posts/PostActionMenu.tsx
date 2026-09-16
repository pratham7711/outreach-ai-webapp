"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";

/**
 * The menu that replaced the icons in a post tile's corner.
 *
 * Every tile used to carry a tracking toggle and a link to our own post page,
 * and a list row carries six buttons. That is a lot of permanent chrome over a
 * screen whose job is looking at artwork, so the per-post actions moved in
 * here, where they cost nothing until someone asks for them.
 *
 * It holds no policy of its own. What a post may have done to it depends on
 * the campaign's approval mode, whether it is already tracked, whether the
 * right-clicked post is part of a larger selection -- all of which PostsTab
 * knows and this does not. So the parent passes the finished list and this
 * draws it, which also means one menu serves both the grid and the list.
 */

export type PostMenuItem =
  | {
      kind: "action";
      label: string;
      icon?: ReactNode;
      onSelect: () => void;
      danger?: boolean;
      disabled?: boolean;
    }
  | { kind: "link"; label: string; icon?: ReactNode; href: string; external?: boolean }
  | { kind: "sep" }
  | { kind: "head"; label: string };

/** Kept off the viewport edges by this much when the click was near one. */
const EDGE_GAP = 8;

export default function PostActionMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: PostMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  /* Measured, then moved, before the browser paints: a right-click low on a
     long list would otherwise open a menu whose last item is under the fold,
     and the reader would watch it jump. */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const left = Math.max(EDGE_GAP, Math.min(x, window.innerWidth - box.width - EDGE_GAP));
    const top = Math.max(EDGE_GAP, Math.min(y, window.innerHeight - box.height - EDGE_GAP));
    setPos({ left, top });
    /* Focus the first thing that can be chosen, so the menu is usable from the
       keyboard and so Escape has somewhere to return from. */
    el.querySelector<HTMLElement>("[data-menuitem]:not([disabled])")?.focus();
  }, [x, y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    /* Closed on scroll rather than repositioned: the menu is anchored to a
       point in the viewport, and a page that moves under it leaves it pointing
       at a different post. */
    const onScroll = () => onClose();
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [onClose]);

  /* Arrow keys walk the items. Without this the menu is reachable by keyboard
     but not navigable by it, which is the more annoying half-measure. */
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const nodes = Array.from(
      ref.current?.querySelectorAll<HTMLElement>("[data-menuitem]:not([disabled])") ?? []
    );
    if (nodes.length === 0) return;
    const at = nodes.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? at + 1 : at - 1;
    nodes[(next + nodes.length) % nodes.length].focus();
  };

  return (
    <div
      ref={ref}
      className="cc-ctxmenu"
      role="menu"
      aria-label="Post actions"
      style={{ left: pos.left, top: pos.top }}
      onKeyDown={onKeyDown}
      /* A right-click inside the menu is a right-click on the page behind it
         otherwise, which closes this one and opens another. */
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) => {
        if (item.kind === "sep") return <div key={`sep-${i}`} className="cc-ctxmenu-sep" role="separator" />;
        if (item.kind === "head")
          return (
            <div key={`head-${i}`} className="cc-ctxmenu-head">
              {item.label}
            </div>
          );
        if (item.kind === "link")
          return (
            <Link
              key={item.label}
              href={item.href}
              data-menuitem=""
              role="menuitem"
              className="cc-ctxmenu-item"
              target={item.external ? "_blank" : undefined}
              rel={item.external ? "noopener noreferrer" : undefined}
              onClick={onClose}
            >
              {item.icon}
              {item.label}
            </Link>
          );
        return (
          <button
            key={item.label}
            type="button"
            data-menuitem=""
            role="menuitem"
            className="cc-ctxmenu-item"
            disabled={item.disabled}
            style={item.danger ? { color: "var(--cc-danger-ink)" } : undefined}
            onClick={() => {
              item.onSelect();
              onClose();
            }}
          >
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
