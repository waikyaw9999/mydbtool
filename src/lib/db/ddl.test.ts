import { describe, expect, it } from "vitest";

import {
  assertDroppableDatabase,
  buildAddColumnSql,
  buildCreateDatabaseSql,
  buildCreateTableSql,
  buildDropColumnSql,
  buildDropDatabaseSql,
  buildDropTableSql,
  buildRenameDatabaseSql,
  buildRenameTableSql,
  defaultSchemaFor,
  isDestructiveManageAction,
  maintenanceDatabaseFor,
  nativeSqlType,
  parseManageRequest,
  supportsRenameDatabase,
} from "./ddl";

describe("parseManageRequest", () => {
  it("rejects unknown actions and unsafe identifiers", () => {
    expect(() => parseManageRequest({ action: "truncate" })).toThrow(/unknown/i);
    expect(() =>
      parseManageRequest({ action: "dropTable", table: "users;drop" }),
    ).toThrow(/invalid/i);
  });

  it("requires confirmation for destructive actions", () => {
    expect(() => parseManageRequest({ action: "dropTable", table: "widgets" })).toThrow(/confirm/i);
    expect(() => parseManageRequest({ action: "dropCollection", collection: "items" })).toThrow(
      /confirm/i,
    );
    expect(
      parseManageRequest({ action: "dropTable", table: "widgets", confirmDestructive: true }).table,
    ).toBe("widgets");
  });

  it("parses Mongo collection names and rejects unsafe ones", () => {
    const req = parseManageRequest({
      action: "createCollection",
      database: "demo",
      collection: "events_2024",
    });
    expect(req).toMatchObject({ action: "createCollection", database: "demo", collection: "events_2024" });
    expect(() =>
      parseManageRequest({ action: "createCollection", database: "demo", collection: "$cmd" }),
    ).toThrow(/invalid/i);
  });

  it("requires a database name and typed confirmation for drop database", () => {
    expect(() => parseManageRequest({ action: "createDatabase" })).toThrow(/database name/i);
    expect(() =>
      parseManageRequest({ action: "dropDatabase", database: "demo2", confirmDestructive: true }),
    ).toThrow(/type the database name/i);
    expect(() =>
      parseManageRequest({
        action: "dropDatabase",
        database: "demo2",
        confirmDestructive: true,
        confirmName: "other",
      }),
    ).toThrow(/type the database name/i);
    expect(
      parseManageRequest({
        action: "dropDatabase",
        database: "demo2",
        confirmDestructive: true,
        confirmName: "demo2",
      }).database,
    ).toBe("demo2");
  });

  it("accepts Mongo database names with hyphens when engine is mongo", () => {
    const req = parseManageRequest(
      { action: "createDatabase", database: "app-events", collection: "init" },
      "mongo",
    );
    expect(req).toMatchObject({ action: "createDatabase", database: "app-events", collection: "init" });
    expect(() => parseManageRequest({ action: "createDatabase", database: "app-events" })).toThrow(
      /invalid/i,
    );
  });

  it("parses create-table columns and forces PK not-null", () => {
    const req = parseManageRequest({
      action: "createTable",
      database: "demo",
      schema: "public",
      table: "widgets",
      columns: [
        { name: "id", type: "int", nullable: true, primaryKey: true },
        { name: "label", type: "text", nullable: true },
      ],
    });
    expect(req.columns?.[0]).toMatchObject({ name: "id", nullable: false, primaryKey: true });
    expect(req.columns?.[1]).toMatchObject({ name: "label", nullable: true });
  });
});

describe("SQL builders", () => {
  it("quotes identifiers in CREATE TABLE and includes a primary key", () => {
    const sql = buildCreateTableSql("postgres", {
      action: "createTable",
      schema: "public",
      table: "widgets",
      columns: [
        { name: "id", type: "int", nullable: false, primaryKey: true },
        { name: "label", type: "text", nullable: true, primaryKey: false },
      ],
    });
    expect(sql).toContain('CREATE TABLE "public"."widgets"');
    expect(sql).toContain('"id" INT NOT NULL');
    expect(sql).toContain("PRIMARY KEY (\"id\")");
    expect(sql).not.toContain(";");
  });

  it("uses database qualification for MySQL and omits schema", () => {
    const sql = buildCreateTableSql("mysql", {
      action: "createTable",
      database: "demo",
      table: "widgets",
      columns: [{ name: "id", type: "int", nullable: false, primaryKey: true }],
    });
    expect(sql).toContain("CREATE TABLE `demo`.`widgets`");
    expect(sql).not.toContain("public");
  });

  it("maps JSON/UUID types per engine", () => {
    expect(nativeSqlType("postgres", "json")).toBe("JSONB");
    expect(nativeSqlType("mysql", "json")).toBe("JSON");
    expect(nativeSqlType("mssql", "uuid")).toBe("UNIQUEIDENTIFIER");
  });

  it("builds DROP IF EXISTS and rename statements", () => {
    expect(
      buildDropTableSql("postgres", { action: "dropTable", schema: "public", table: "widgets" }),
    ).toBe('DROP TABLE IF EXISTS "public"."widgets"');
    expect(
      buildDropTableSql("postgres", {
        action: "dropTable",
        schema: "public",
        table: "v_widgets",
        kind: "view",
      }),
    ).toBe('DROP VIEW IF EXISTS "public"."v_widgets"');
    expect(
      buildRenameTableSql("postgres", {
        action: "renameTable",
        schema: "public",
        table: "old",
        newName: "new",
      }),
    ).toBe('ALTER TABLE "public"."old" RENAME TO "new"');
    expect(
      buildRenameTableSql("mysql", {
        action: "renameTable",
        database: "demo",
        table: "old",
        newName: "new",
      }),
    ).toBe("RENAME TABLE `demo`.`old` TO `demo`.`new`");
    expect(
      buildRenameTableSql("mssql", {
        action: "renameTable",
        schema: "dbo",
        table: "old",
        newName: "new",
      }),
    ).toBe("EXEC sp_rename N'dbo.old', N'new'");
  });

  it("builds add/drop column DDL", () => {
    expect(
      buildAddColumnSql("postgres", {
        action: "addColumn",
        schema: "public",
        table: "widgets",
        column: { name: "notes", type: "text", nullable: true, primaryKey: false },
      }),
    ).toBe('ALTER TABLE "public"."widgets" ADD COLUMN "notes" TEXT NULL');
    expect(
      buildDropColumnSql("mssql", {
        action: "dropColumn",
        schema: "dbo",
        table: "widgets",
        columnName: "notes",
      }),
    ).toBe("ALTER TABLE [dbo].[widgets] DROP COLUMN [notes]");
  });

  it("defaults schema per engine", () => {
    expect(defaultSchemaFor("postgres")).toBe("public");
    expect(defaultSchemaFor("mssql")).toBe("dbo");
    expect(defaultSchemaFor("mysql")).toBeUndefined();
  });

  it("marks drop table/column/collection/database as destructive", () => {
    expect(isDestructiveManageAction("dropTable")).toBe(true);
    expect(isDestructiveManageAction("dropColumn")).toBe(true);
    expect(isDestructiveManageAction("dropCollection")).toBe(true);
    expect(isDestructiveManageAction("dropDatabase")).toBe(true);
    expect(isDestructiveManageAction("createTable")).toBe(false);
    expect(isDestructiveManageAction("renameCollection")).toBe(false);
    expect(isDestructiveManageAction("createDatabase")).toBe(false);
  });

  it("builds quoted CREATE/DROP DATABASE statements", () => {
    expect(buildCreateDatabaseSql("postgres", "demo2")).toBe('CREATE DATABASE "demo2"');
    expect(buildCreateDatabaseSql("mysql", "demo2")).toBe("CREATE DATABASE `demo2`");
    expect(buildCreateDatabaseSql("mssql", "demo2")).toBe("CREATE DATABASE [demo2]");
    expect(buildDropDatabaseSql("postgres", "demo2")).toBe('DROP DATABASE IF EXISTS "demo2"');
    expect(buildRenameDatabaseSql("postgres", "old", "new")).toBe(
      'ALTER DATABASE "old" RENAME TO "new"',
    );
    expect(buildRenameDatabaseSql("mssql", "old", "new")).toBe(
      "ALTER DATABASE [old] MODIFY NAME = [new]",
    );
    expect(() => buildRenameDatabaseSql("mysql", "old", "new")).toThrow(/does not support/i);
  });

  it("refuses system catalogs and the connection's own database", () => {
    expect(() => assertDroppableDatabase("postgres", "postgres")).toThrow(/system/i);
    expect(() => assertDroppableDatabase("mysql", "mysql")).toThrow(/system/i);
    expect(() => assertDroppableDatabase("mssql", "master")).toThrow(/system/i);
    expect(() => assertDroppableDatabase("mongo", "admin")).toThrow(/system/i);
    expect(() => assertDroppableDatabase("postgres", "demo", "demo")).toThrow(/opens that database/i);
    expect(assertDroppableDatabase("postgres", "demo2", "postgres")).toBe("demo2");
    expect(assertDroppableDatabase("mongo", "demo", "demo")).toBe("demo");
  });

  it("picks a maintenance catalog for CREATE/DROP DATABASE", () => {
    expect(maintenanceDatabaseFor("postgres", "demo2", "demo")).toBe("postgres");
    expect(maintenanceDatabaseFor("postgres", "postgres", "postgres")).toBe("template1");
    expect(maintenanceDatabaseFor("mssql", "demo2", "demo")).toBe("master");
    expect(maintenanceDatabaseFor("mysql", "demo2", "demo")).toBe("demo");
    expect(supportsRenameDatabase("postgres")).toBe(true);
    expect(supportsRenameDatabase("mysql")).toBe(false);
    expect(supportsRenameDatabase("mongo")).toBe(false);
  });
});
