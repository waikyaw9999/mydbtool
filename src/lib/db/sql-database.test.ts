import { describe, expect, it } from "vitest";

import { listSqlDatabases, resolveQueryDatabase } from "./sql-database";

describe("resolveQueryDatabase", () => {
  it("falls back to the connection database when the request omits it", () => {
    expect(resolveQueryDatabase("postgres")).toBe("postgres");
    expect(resolveQueryDatabase("postgres", undefined)).toBe("postgres");
    expect(resolveQueryDatabase("postgres", null)).toBe("postgres");
    expect(resolveQueryDatabase("postgres", "   ")).toBe("postgres");
    expect(resolveQueryDatabase("postgres", 1)).toBe("postgres");
  });

  it("uses a trimmed request override", () => {
    expect(resolveQueryDatabase("postgres", "  myapp  ")).toBe("myapp");
  });

  it("rejects oversized or control-character names", () => {
    expect(() => resolveQueryDatabase("postgres", "x".repeat(129))).toThrow(/too long/i);
    expect(() => resolveQueryDatabase("postgres", "db\0name")).toThrow(/invalid/i);
    expect(() => resolveQueryDatabase("postgres", "db\nname")).toThrow(/invalid/i);
  });
});

describe("listSqlDatabases", () => {
  it("includes the connection default, active tab, and tree catalogs", () => {
    expect(
      listSqlDatabases({
        connectionDatabase: "postgres",
        activeDatabase: "myapp",
        tree: [
          { kind: "database", name: "analytics" },
          { kind: "schema", name: "public" },
          { kind: "database", name: "postgres" },
        ],
      }),
    ).toEqual(["analytics", "myapp", "postgres"]);
  });

  it("returns a single entry when only the connection database is known", () => {
    expect(listSqlDatabases({ connectionDatabase: "demo" })).toEqual(["demo"]);
  });
});
