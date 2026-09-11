import { describe, expect, it } from "vitest";

import { parseOptions, validateConnectionInput } from "./validation";

describe("validateConnectionInput", () => {
  const valid = {
    name: "Local PG",
    engine: "postgres",
    host: "localhost",
    port: 5432,
    database: "demo",
    username: "postgres",
    password: "secret",
    ssl: false,
    readOnly: true,
    options: "",
  };

  it("accepts a complete SQL connection", () => {
    const result = validateConnectionInput(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.engine).toBe("postgres");
      expect(result.value.port).toBe(5432);
      expect(result.value.readOnly).toBe(true);
    }
  });

  it("requires a name, host, and known engine", () => {
    const result = validateConnectionInput({
      ...valid,
      name: "  ",
      host: "",
      engine: "redis",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.name).toMatch(/required/i);
      expect(result.errors.host).toMatch(/required/i);
      expect(result.errors.engine).toMatch(/postgres/);
    }
  });

  it("rejects out-of-range ports", () => {
    const result = validateConnectionInput({ ...valid, port: 70000 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.port).toMatch(/65535/);
  });

  it("requires a database for SQL engines but not Mongo", () => {
    const sql = validateConnectionInput({ ...valid, database: "" });
    expect(sql.ok).toBe(false);
    const mongo = validateConnectionInput({ ...valid, engine: "mongo", database: "", port: 27017 });
    expect(mongo.ok).toBe(true);
  });

  it("fills the default port when omitted", () => {
    const result = validateConnectionInput({ ...valid, engine: "mysql", port: "" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.port).toBe(3306);
  });
});

describe("parseOptions", () => {
  it("parses key=value lines and JSON objects", () => {
    expect(parseOptions("authSource=admin\nreplicaSet=rs0")).toEqual({
      authSource: "admin",
      replicaSet: "rs0",
    });
    expect(parseOptions('{"encrypt":true}')).toEqual({ encrypt: "true" });
  });

  it("ignores comments and empty input", () => {
    expect(parseOptions("# hello\n\n")).toEqual({});
    expect(parseOptions("")).toEqual({});
  });
});
