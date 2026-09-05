"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  applyResolved,
  readStoredChoice,
  resolveChoice,
  storeChoice,
  systemPrefersDark,
  type ThemeChoice,
} from "./theme";

type ThemeContextValue = {
  /** The user's choice: "light" | "dark" | "system". */
  choice: ThemeChoice;
  /** What "system" currently resolves to — useful for labelling the toggle. */
  resolved: "light" | "dark";
  /** Whether the provider has mounted (so the UI can avoid a hydration mismatch). */
  ready: boolean;
  setChoice: (choice: ThemeChoice) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>("system");
  const [resolved, setResolved] = useState<"light" | "dark">("light");
  const [ready, setReady] = useState(false);

  // On mount, adopt whatever the pre-paint script already applied.
  useEffect(() => {
    const stored = readStoredChoice();
    setChoiceState(stored);
    setResolved(resolveChoice(stored));
    setReady(true);
  }, []);

  // Follow OS changes while the choice is "system".
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (choice !== "system") return;
      const next = systemPrefersDark() ? "dark" : "light";
      setResolved(next);
      applyResolved(next);
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [choice]);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    storeChoice(next);
    const nextResolved = resolveChoice(next);
    setResolved(nextResolved);
    applyResolved(nextResolved);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ choice, resolved, ready, setChoice }),
    [choice, resolved, ready, setChoice],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within <ThemeProvider>");
  return ctx;
}
