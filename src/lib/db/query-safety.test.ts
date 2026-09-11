import { describe, expect, it } from "vitest";

import {
  analyzeMongoMode,
  analyzeSql,
  assertMongoAllowed,
  assertSqlAllowed,
  clampLimit,
  clampOffset,
  MAX_RESULT_LIMIT,
} from "./query-safety";

describe("analyzeSql", () => {
  it("treats SELECT as read and not destructive", () => {
    const analysis = analyzeSql("SELECT * FROM users WHERE active = true");
    expect(analysis.kind).toBe("read");
    expect(analysis.destructive).toBe(false);
  });

  it("flags DELETE, DROP, TRUNCATE, and ALTER as destructive writes", () => {
    for (const sql of ["DELETE FROM t", "DROP TABLE t", "TRUNCATE t", "ALTER TABLE t ADD x int"]) {
      const analysis = analyzeSql(sql);
      expect(analysis.kind).toBe("write");
      expect(analysis.destructive).toBe(true);
    }
  });

  it("flags INSERT/UPDATE as writes without destructive confirmation", () => {
    expect(analyzeSql("INSERT INTO t VALUES (1)").destructive).toBe(false);
    expect(analyzeSql("UPDATE t SET x = 1").kind).toBe("write");
  });

  it("ignores keywords inside SQL comments", () => {
    const analysis = analyzeSql("SELECT 1 -- DELETE FROM t\n/* DROP TABLE x */");
    expect(analysis.kind).toBe("read");
    expect(analysis.destructive).toBe(false);
  });

  it("blocks writes on read-only connections", () => {
    expect(() => assertSqlAllowed("DELETE FROM t", true)).toThrow(/read-only/i);
    expect(() => assertSqlAllowed("SELECT 1", true)).not.toThrow();
    expect(() => assertSqlAllowed("   ", false)).toThrow(/empty/i);
  });
});

describe("mongo query safety", () => {
  it("allows find and aggregate, including on read-only connections", () => {
    expect(analyzeMongoMode("find")).toEqual({ readOnly: true, destructive: false });
    expect(() => assertMongoAllowed("aggregate", true)).not.toThrow();
  });

  it("rejects unknown or write modes", () => {
    expect(() => assertMongoAllowed("deleteMany", false)).toThrow(/find and aggregate/i);
    expect(analyzeMongoMode("drop").destructive).toBe(true);
  });
});

describe("result limits", () => {
  it("clamps limit and offset to safe bounds", () => {
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(9999)).toBe(MAX_RESULT_LIMIT);
    expect(clampLimit("nope")).toBe(100);
    expect(clampOffset(-4)).toBe(0);
    expect(clampOffset(25)).toBe(25);
  });
});
