"use client";

import { useMemo } from "react";

/**
 * Has an edit form changed since it was loaded? An Edit form's Save waits for
 * this (an Add form's waits for its required fields instead).
 *
 *   const [saved, setSaved] = useState<Form | null>(null); // set on load and after a save
 *   const [form, setForm] = useState<Form>(EMPTY);
 *   const dirty = useDirty(saved, form);
 *   <Button type="submit" disabled={!dirty || saving}>Save changes</Button>
 *   Cancel: setForm(saved)
 *
 * The comparison is structural over plain data (strings, numbers, booleans,
 * null, arrays and plain objects), so typing a character and deleting it
 * again counts as no change. Before the snapshot exists (still loading) the
 * form is never dirty.
 */
export function useDirty<T>(saved: T | null | undefined, current: T): boolean {
  return useMemo(() => saved !== null && saved !== undefined && !sameValue(saved, current), [saved, current]);
}

export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  }
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) => Object.prototype.hasOwnProperty.call(b, k) && sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}
