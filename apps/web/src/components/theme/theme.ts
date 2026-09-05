/**
 * Client-side theme handling. Three user choices — "light", "dark", "system" —
 * where "system" tracks the OS `prefers-color-scheme`. The resolved value only
 * ever toggles a single `dark` class on <html>; every `dark:` Tailwind variant
 * and the `.dark .viz` chart tokens key off that class.
 *
 * This is presentation-only state for the browser. It is never sent to the
 * server and never influences canonicalization, hashing, or anchoring.
 */

export type ThemeChoice = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "okf-theme";

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === "light" || value === "dark" || value === "system";
}

/** The choice persisted in localStorage, or "system" when absent/invalid/unavailable. */
export function readStoredChoice(): ThemeChoice {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeChoice(raw) ? raw : "system";
  } catch {
    return "system";
  }
}

export function storeChoice(choice: ThemeChoice): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    /* private mode / storage disabled — the class is still applied in-memory */
  }
}

export function systemPrefersDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveChoice(choice: ThemeChoice): "light" | "dark" {
  if (choice === "system") return systemPrefersDark() ? "dark" : "light";
  return choice;
}

/** Apply a resolved theme to the document root. */
export function applyResolved(resolved: "light" | "dark"): void {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
}

/**
 * Blocking snippet injected into <head> so the correct class is present before
 * first paint — no flash of the wrong theme on load or navigation. Kept tiny
 * and self-contained; it must not reference anything outside its own scope.
 */
export const themeInitScript = `(function(){try{var k=${JSON.stringify(
  THEME_STORAGE_KEY,
)};var c=localStorage.getItem(k);if(c!=="light"&&c!=="dark"&&c!=="system")c="system";var d=c==="dark"||(c==="system"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);var e=document.documentElement;e.classList.toggle("dark",d);e.style.colorScheme=d?"dark":"light";}catch(_){}})();`;
