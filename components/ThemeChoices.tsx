"use client";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { Sun, Moon, Monitor, Check } from "lucide-react";

/* The three choices, in the order the menus list them. The keys are
   next-themes' own theme names, unchanged, so a choice saved under the old
   cycling button ("light", "dark") is still the one selected here. */
export const THEME_CHOICES = [
  { key: "light", label: "Light", icon: Sun },
  { key: "dark", label: "Dark", icon: Moon },
  { key: "system", label: "System", icon: Monitor },
] as const;

export type ThemeChoiceKey = (typeof THEME_CHOICES)[number]["key"];

/* false on the server and through hydration, true after: the saved theme
   lives in localStorage, so before then any answer would be a guess. */
const noSubscribe = () => () => {};

/** The saved choice (not the resolved one: "system" stays "system"), or null
 *  before mount, when next-themes cannot know it yet. */
export function useThemeChoice(): { current: string | null; choose: (key: ThemeChoiceKey) => void } {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  return { current: mounted ? (theme ?? "system") : null, choose: setTheme };
}

/** The rail's account popover: a labelled radio group, one row per theme. */
export function ThemeRadioGroup() {
  const { current, choose } = useThemeChoice();
  return (
    <div role="radiogroup" aria-label="Theme" className="cc-rail-theme">
      <span className="cc-rail-theme-label" aria-hidden="true">Theme</span>
      {THEME_CHOICES.map(({ key, label, icon: Icon }) => {
        const on = current === key;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={on}
            className="cc-nav-item cc-rail-theme-choice"
            data-action="switch-theme"
            data-theme-choice={key}
            onClick={() => choose(key)}
          >
            <Icon size={15} aria-hidden="true" />
            <span>{label}</span>
            {on && <Check size={14} aria-hidden="true" className="cc-rail-theme-check" />}
          </button>
        );
      })}
    </div>
  );
}
