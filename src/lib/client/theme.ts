export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "mydbtool-theme";

export function parseTheme(value: unknown): Theme | null {
  return value === "light" || value === "dark" ? value : null;
}

/** Saved preference wins; otherwise `prefers-color-scheme`. */
export function resolveInitialTheme(stored: unknown, prefersLight: boolean): Theme {
  return parseTheme(stored) ?? (prefersLight ? "light" : "dark");
}

export function readStoredTheme(): Theme | null {
  try {
    return parseTheme(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function prefersLightScheme(): boolean {
  return window.matchMedia("(prefers-color-scheme: light)").matches;
}

export function readAppliedTheme(): Theme {
  return parseTheme(document.documentElement.getAttribute("data-theme"))
    ?? readStoredTheme()
    ?? (prefersLightScheme() ? "light" : "dark");
}

const listeners = new Set<() => void>();

export function subscribeTheme(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // private mode / quota
  }
  listeners.forEach((listener) => listener());
}

export function getThemeSnapshot(): Theme {
  return readAppliedTheme();
}

export function getServerThemeSnapshot(): Theme {
  return "dark";
}

export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var t=localStorage.getItem(k);if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";}document.documentElement.setAttribute("data-theme",t);}catch(e){document.documentElement.setAttribute("data-theme","dark");}})();`;
