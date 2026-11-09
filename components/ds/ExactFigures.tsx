"use client";

import { createContext, useContext, type ReactNode } from "react";
import { compactCount, formatCompact, formatFull } from "@/lib/format";

const ExactFiguresContext = createContext(false);

export function ExactFigures({ children }: { children: ReactNode }) {
  return <ExactFiguresContext.Provider value>{children}</ExactFiguresContext.Provider>;
}

export function useExactFigures(): boolean {
  return useContext(ExactFiguresContext);
}

export function useCompactCount(): typeof compactCount {
  const exact = useExactFigures();
  return exact ? () => null : compactCount;
}

export function useAxisFigure(): (n: number) => string {
  const exact = useExactFigures();
  return exact ? formatFull : formatCompact;
}
