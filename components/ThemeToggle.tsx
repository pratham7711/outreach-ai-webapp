"use client";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Sun, Moon, Palette } from "lucide-react";

const CYCLE = [
  { key: "light", icon: Sun, label: "Light mode" },
  { key: "dark", icon: Moon, label: "Dark mode" },
  { key: "creatorcore", icon: Palette, label: "CreatorCore mode" },
] as const;

export default function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Reserves the button's box before hydration so the footer row does not
  // reflow under the account chip on first paint.
  if (!mounted) return <span className="cc-icon-btn" aria-hidden="true" />;

  const current = Math.max(0, CYCLE.findIndex((t) => t.key === resolvedTheme));
  const next = CYCLE[(current + 1) % CYCLE.length];
  const Icon = CYCLE[current].icon;

  return (
    <button
      type="button"
      onClick={() => setTheme(next.key)}
      className="cc-icon-btn btn-press"
      data-action="switch-theme"
      /* The glyph shows the theme you are IN; the label says the one you are
         going TO. That split is deliberate -- a three-way cycle has no single
         "off" state to draw -- but it is the reason the label is not optional. */
      aria-label={`Switch to ${next.label}`}
      title={`Switch to ${next.label}`}
    >
      <Icon size={17} />
    </button>
  );
}
