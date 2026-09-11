import { describe, expect, it } from "vitest";

import { parseTheme, resolveInitialTheme } from "./theme";

describe("parseTheme", () => {
  it("accepts light and dark only", () => {
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("system")).toBeNull();
    expect(parseTheme("")).toBeNull();
    expect(parseTheme(null)).toBeNull();
  });
});

describe("resolveInitialTheme", () => {
  it("uses a stored preference over the OS scheme", () => {
    expect(resolveInitialTheme("light", false)).toBe("light");
    expect(resolveInitialTheme("dark", true)).toBe("dark");
  });

  it("falls back to prefers-color-scheme when nothing is stored", () => {
    expect(resolveInitialTheme(null, true)).toBe("light");
    expect(resolveInitialTheme("nope", false)).toBe("dark");
  });
});
