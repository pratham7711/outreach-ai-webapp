/**
 * @jest-environment node
 *
 * The inline <head> script is a string, so it is run here the way the browser
 * runs it: as source, against a localStorage, before next-themes looks.
 */
import { RETIRED_THEMES, THEME_MIGRATION_SCRIPT, THEME_STORAGE_KEY } from "@/lib/themeStorage";

function runWith(storage: { getItem(k: string): string | null; setItem(k: string, v: string): void }) {
  new Function("localStorage", THEME_MIGRATION_SCRIPT)(storage);
}

function memoryStorage(initial: Record<string, string>) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: jest.fn((k: string, v: string) => void data.set(k, v)),
  };
}

describe("THEME_MIGRATION_SCRIPT", () => {
  it("rewrites a saved creatorcore choice to light", () => {
    const s = memoryStorage({ [THEME_STORAGE_KEY]: "creatorcore" });
    runWith(s);
    expect(s.data.get(THEME_STORAGE_KEY)).toBe("light");
  });

  it.each(["light", "dark", "system"])("leaves a saved %s choice alone", (theme) => {
    const s = memoryStorage({ [THEME_STORAGE_KEY]: theme });
    runWith(s);
    expect(s.data.get(THEME_STORAGE_KEY)).toBe(theme);
    expect(s.setItem).not.toHaveBeenCalled();
  });

  it("writes nothing when no choice was ever saved", () => {
    const s = memoryStorage({});
    runWith(s);
    expect(s.data.has(THEME_STORAGE_KEY)).toBe(false);
    expect(s.setItem).not.toHaveBeenCalled();
  });

  it("does not treat inherited object keys as retired themes", () => {
    const s = memoryStorage({ [THEME_STORAGE_KEY]: "constructor" });
    runWith(s);
    expect(s.data.get(THEME_STORAGE_KEY)).toBe("constructor");
    expect(s.setItem).not.toHaveBeenCalled();
  });

  it("swallows a storage that throws, as a blocked localStorage does", () => {
    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: jest.fn(),
    };
    expect(() => runWith(blocked)).not.toThrow();
  });

  it("maps every retired theme onto one that still exists", () => {
    for (const target of Object.values(RETIRED_THEMES)) {
      expect(["light", "dark", "system"]).toContain(target);
    }
  });
});
