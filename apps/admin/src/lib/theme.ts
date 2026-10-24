// The admin theme (docs/06 §2.2): system, light or dark. "System" follows the OS (the tokens' media query); light
// and dark set `data-theme` on <html>, which the generated tokens.css honours. The choice is kept on this device
// only (localStorage), and applied before the first paint by `applyStoredTheme()` in main.tsx.
import { useSyncExternalStore } from "react";

export type ThemePref = "system" | "light" | "dark";
export const THEME_PREFS: readonly ThemePref[] = ["system", "light", "dark"];
export const THEME_LABELS: Record<ThemePref, string> = { system: "System", light: "Light", dark: "Dark" };

const KEY = "ta-admin-theme";
const listeners = new Set<() => void>();
/** The choice made on this page (wins when storage is unavailable). */
let chosen: ThemePref | null = null;

function read(): ThemePref {
  if (chosen) return chosen;
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function apply(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", pref);
}

export function applyStoredTheme() {
  apply(read());
}

export function setTheme(pref: ThemePref) {
  chosen = pref;
  try {
    if (pref === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    // Private mode: the choice lasts for this page only.
  }
  apply(pref);
  for (const l of listeners) l();
}

export function useTheme(): ThemePref {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => "system",
  );
}
