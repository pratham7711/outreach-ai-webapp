/** ISO 3166-1 alpha-2 to an English name; the code itself where Intl has none. */
export const regionName = (() => {
  try {
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    return (code: string) => {
      try {
        return names.of(code.toUpperCase()) ?? code;
      } catch {
        return code;
      }
    };
  } catch {
    return (code: string) => code;
  }
})();

/** Instagram's age bands sorted youngest first: "13-17", "18-24", …, "65+". */
export const byAgeBand = (a: { key: string }, b: { key: string }) => (parseInt(a.key, 10) || 0) - (parseInt(b.key, 10) || 0);

/** "18-24" → "18–24". */
export const ageLabel = (key: string) => key.replace("-", "–");
