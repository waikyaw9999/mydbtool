"use client";

import { useSyncExternalStore } from "react";

import {
  applyTheme,
  getServerThemeSnapshot,
  getThemeSnapshot,
  subscribeTheme,
} from "@/lib/client/theme";

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getServerThemeSnapshot);

  return (
    <div className="theme-toggle" role="group" aria-label="Color theme">
      <button
        type="button"
        aria-pressed={theme === "dark"}
        onClick={() => applyTheme("dark")}
      >
        Dark
      </button>
      <button
        type="button"
        aria-pressed={theme === "light"}
        onClick={() => applyTheme("light")}
      >
        Light
      </button>
    </div>
  );
}
