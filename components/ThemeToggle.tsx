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
  if (!mounted) return <span style={{ width: 34, height: 34, display: "inline-block" }} />;

  const current = Math.max(0, CYCLE.findIndex((t) => t.key === resolvedTheme));
  const next = CYCLE[(current + 1) % CYCLE.length];
  const Icon = CYCLE[current].icon;

  return (
    <button
      type="button"
      onClick={() => setTheme(next.key)}
      className="cc-btn-ghost btn-press"
      style={{
        width: 34,
        height: 34,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 8,
        color: "var(--cc-text-muted)",
        background: "transparent",
        border: "none",
        cursor: "pointer",
      }}
      aria-label={`Switch to ${next.label}`}
      title={`Switch to ${next.label}`}
    >
      <Icon size={17} />
    </button>
  );
}
