"use client";

import { MoreHorizontal } from "lucide-react";
import { MenuButton, type MenuButtonItem } from "./MenuButton";

/**
 * The ⋯ button that holds a row's occasional and destructive actions.
 *
 * A header or row keeps its main action and at most one or two others as
 * labelled buttons; everything else goes here. The list header had seven
 * buttons in a line (Delete, Export, Archive, Import rates, Duplicate, Share,
 * Add Creators) and wrapped under its own title, and three screens put a red
 * Delete or Remove all in the open beside everyday buttons. MenuButton draws a
 * rule above the first danger item, so destructive actions sit last and apart.
 *
 * `size` matches the buttons beside it: "sm" and "md" are the library's button
 * heights (page headers), "inline" is the app's icon-button box with a card
 * background, for controls on a card or a banner.
 *
 * The menu is portalled: each campaign card runs a fade-in, which makes it its
 * own stacking context, so a menu drawn inside one card was painted over by
 * the next card down.
 */
export function MoreMenu({
  label,
  items,
  size = "md",
  align = "right",
}: {
  /** Names what the actions are about, e.g. "More list actions". */
  label: string;
  items: MenuButtonItem[];
  size?: "sm" | "md" | "inline";
  align?: "left" | "right";
}) {
  if (items.length === 0) return null;
  const btn = size === "inline" ? "cc-more-btn cc-more-btn--inline" : `ui-btn ui-btn-secondary ui-btn-${size} cc-more-btn`;
  return (
    <MenuButton
      label={label}
      align={align}
      items={items}
      triggerClassName={btn}
      portal
      triggerTitle="More actions"
      trigger={<MoreHorizontal size={size === "sm" ? 16 : 18} aria-hidden="true" />}
    />
  );
}
