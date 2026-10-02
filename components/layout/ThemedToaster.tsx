"use client";

import { useTheme } from "next-themes";
import { Toaster, type ToasterProps } from "sonner";

/**
 * sonner's Toaster, told which theme the page is in.
 *
 * Left alone it paints its light palette everywhere, so under Dark every toast
 * was a pale pink slab with red error text on a near-black page.
 * CreatorCore is a light theme, so anything but a resolved "dark" is light.
 */
export function ThemedToaster(props: ToasterProps) {
  const { resolvedTheme } = useTheme();
  return <Toaster theme={resolvedTheme === "dark" ? "dark" : "light"} {...props} />;
}
