import type { Engine } from "@/lib/connections/types";
import { assertSafeMongoIdent, assertSafeSqlIdent, qualifyTable, quoteIdent } from "@/lib/db/identifiers";

export const MANAGE_ACTIONS = [
  "createTable",
  "dropTable",
  "renameTable",
  "addColumn",
  "dropColumn",
  "createCollection",
  "dropCollection",
  "renameCollection",
  "createDatabase",
  "dropDatabase",
  "renameDatabase",
] as const;

export const DEFAULT_MONGO_INIT_COLLECTION = "_init";

export const SYSTEM_DATABASES: Record<Engine, readonly string[]> = {
  postgres: ["postgres", "template0", "template1"],
  mysql: ["mysql", "information_schema", "performance_schema", "sys"],
  mssql: ["master", "tempdb", "model", "msdb"],
  mongo: ["admin", "local", "config"],
};

export type ManageAction = (typeof MANAGE_ACTIONS)[number];

export const SQL_COLUMN_TYPES = [
  "int",
  "bigint",
  "numeric",
  "text",
  "varchar",
  "boolean",
  "timestamp",
  "date",
  "json",
  "uuid",
] as const;

export type SqlColumnType = (typeof SQL_COLUMN_TYPES)[number];

export const SQL_TYPE_LABELS: Record<SqlColumnType, string> = {
  int: "Integer",
  bigint: "Big integer",
  numeric: "Numeric",
  text: "Text",
  varchar: "Varchar(255)",
  boolean: "Boolean",
  timestamp: "Timestamp",
  date: "Date",
  json: "JSON",
  uuid: "UUID",
};

export type ColumnInput = {
  name: string;
  type: SqlColumnType;
  nullable: boolean;
  primaryKey: boolean;
};

export type ManageRequest = {
  action: ManageAction;
  database?: string;
  schema?: string;
  table?: string;
  kind?: "table" | "view";
  collection?: string;
  newName?: string;
  columns?: ColumnInput[];
  column?: ColumnInput;
  columnName?: string;
  confirmDestructive?: boolean;
  /** Must match `database` for dropDatabase. */
  confirmName?: string;
};

export function isManageAction(value: unknown): value is ManageAction {
  return typeof value === "string" && (MANAGE_ACTIONS as readonly string[]).includes(value);
}

export function isSqlColumnType(value: unknown): value is SqlColumnType {
  return typeof value === "string" && (SQL_COLUMN_TYPES as readonly string[]).includes(value);
}

export function defaultSchemaFor(engine: Engine): string | undefined {
  if (engine === "mysql" || engine === "mongo") return undefined;
  if (engine === "mssql") return "dbo";
  return "public";
}

export function isDestructiveManageAction(action: ManageAction): boolean {
  return (
    action === "dropTable" ||
    action === "dropColumn" ||
    action === "dropCollection" ||
    action === "dropDatabase"
  );
}

export function isDatabaseManageAction(action: ManageAction): boolean {
  return action === "createDatabase" || action === "dropDatabase" || action === "renameDatabase";
}

export function supportsRenameDatabase(engine: Engine): boolean {
  return engine === "postgres" || engine === "mssql";
}

export function isSystemDatabase(engine: Engine, name: string): boolean {
  const lowered = name.toLowerCase();
  return SYSTEM_DATABASES[engine].some((item) => item.toLowerCase() === lowered);
}

export function assertDroppableDatabase(engine: Engine, name: string, connectionDatabase?: string): string {
  return assertMutableCatalog(engine, name, connectionDatabase, "drop");
}

export function assertMutableCatalog(
  engine: Engine,
  name: string,
  connectionDatabase: string | undefined,
  verb: "drop" | "rename",
): string {
  assertSafeDatabaseIdent(engine, name);
  if (isSystemDatabase(engine, name)) {
    throw new Error(`Cannot ${verb} system database “${name}”.`);
  }
  if (engine !== "mongo" && connectionDatabase && connectionDatabase === name) {
    const hint =
      engine === "postgres"
        ? "Edit the connection to open “postgres” (or another catalog), then try again."
        : engine === "mssql"
          ? "Edit the connection to open “master” (or another catalog), then try again."
          : "Edit the connection to open another schema, then try again.";
    throw new Error(
      `Cannot ${verb} “${name}” while this connection opens that database. ${hint}`,
    );
  }
  return name;
}

export function assertSafeDatabaseIdent(engine: Engine, name: string): string {
  if (engine === "mongo") return assertSafeMongoIdent(name, "database");
  return assertSafeSqlIdent(name, "database");
}

/** Catalog used to run CREATE/DROP/RENAME DATABASE so we are not inside the target. */
export function maintenanceDatabaseFor(
  engine: Engine,
  target: string,
  connectionDatabase?: string,
): string | undefined {
  if (engine === "postgres") {
    return target === "postgres" ? "template1" : "postgres";
  }
  if (engine === "mssql") return "master";
  return connectionDatabase;
}

function usesMongoIdents(action: ManageAction, engine?: Engine): boolean {
  if (engine === "mongo") return true;
  return action.includes("Collection");
}

export function nativeSqlType(engine: Engine, type: SqlColumnType): string {
  switch (type) {
    case "int":
      return "INT";
    case "bigint":
      return "BIGINT";
    case "numeric":
      return engine === "mssql" ? "DECIMAL(18,2)" : "NUMERIC(18,2)";
    case "text":
      return engine === "mssql" ? "NVARCHAR(MAX)" : "TEXT";
    case "varchar":
      return engine === "mssql" ? "NVARCHAR(255)" : "VARCHAR(255)";
    case "boolean":
      if (engine === "mysql") return "TINYINT(1)";
      if (engine === "mssql") return "BIT";
      return "BOOLEAN";
    case "timestamp":
      if (engine === "postgres") return "TIMESTAMPTZ";
      if (engine === "mysql") return "DATETIME";
      return "DATETIME2";
    case "date":
      return "DATE";
    case "json":
      if (engine === "postgres") return "JSONB";
      if (engine === "mysql") return "JSON";
      return "NVARCHAR(MAX)";
    case "uuid":
      if (engine === "postgres") return "UUID";
      if (engine === "mssql") return "UNIQUEIDENTIFIER";
      return "CHAR(36)";
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseColumn(raw: unknown, index: number): ColumnInput {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const name = asString(row.name);
  assertSafeSqlIdent(name, `column ${index + 1} name`);
  if (!isSqlColumnType(row.type)) {
    throw new Error(`Column ${index + 1} has an unsupported type.`);
  }
  const primaryKey = Boolean(row.primaryKey);
  return {
    name,
    type: row.type,
    nullable: primaryKey ? false : Boolean(row.nullable),
    primaryKey,
  };
}

export function parseManageRequest(raw: unknown, engine?: Engine): ManageRequest {
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (!isManageAction(body.action)) {
    throw new Error("Unknown object action.");
  }
  const action = body.action;
  const database = asString(body.database) || undefined;
  const schema = asString(body.schema) || undefined;
  const table = asString(body.table) || undefined;
  const collection = asString(body.collection) || undefined;
  const newName = asString(body.newName) || undefined;
  const columnName = asString(body.columnName) || undefined;
  const confirmName = asString(body.confirmName) || undefined;
  const kind = body.kind === "view" ? "view" : "table";
  const mongoIdents = usesMongoIdents(action, engine);

  if (database) {
    if (mongoIdents) assertSafeMongoIdent(database, "database");
    else assertSafeSqlIdent(database, "database");
  }
  if (schema) assertSafeSqlIdent(schema, "schema");
  if (table) assertSafeSqlIdent(table, "table");
  if (collection) assertSafeMongoIdent(collection, "collection");
  if (newName) {
    if (action === "renameCollection" || (action === "renameDatabase" && mongoIdents)) {
      assertSafeMongoIdent(newName, "new name");
    } else {
      assertSafeSqlIdent(newName, "new name");
    }
  }
  if (columnName) assertSafeSqlIdent(columnName, "column");

  let columns: ColumnInput[] | undefined;
  if (Array.isArray(body.columns)) {
    columns = body.columns.map(parseColumn);
    const names = new Set<string>();
    for (const col of columns) {
      if (names.has(col.name)) throw new Error(`Duplicate column “${col.name}”.`);
      names.add(col.name);
    }
  }
  const column = body.column ? parseColumn(body.column, 0) : undefined;
  const confirmDestructive = Boolean(body.confirmDestructive);

  if (isDestructiveManageAction(action) && !confirmDestructive) {
    throw new Error("Confirm this destructive action to continue.");
  }

  const sqlTableActions: ManageAction[] = [
    "createTable",
    "dropTable",
    "renameTable",
    "addColumn",
    "dropColumn",
  ];
  if (sqlTableActions.includes(action) && !table) {
    throw new Error("Table name is required.");
  }
  if (action === "createTable" && !columns?.length) {
    throw new Error("Add at least one column.");
  }
  if ((action === "renameTable" || action === "renameCollection" || action === "renameDatabase") && !newName) {
    throw new Error("New name is required.");
  }
  if (action === "addColumn" && !column) {
    throw new Error("Column definition is required.");
  }
  if (action === "dropColumn" && !columnName) {
    throw new Error("Column name is required.");
  }
  if (
    (action === "createCollection" || action === "dropCollection" || action === "renameCollection") &&
    !collection
  ) {
    throw new Error("Collection name is required.");
  }
  if (isDatabaseManageAction(action) && !database) {
    throw new Error("Database name is required.");
  }
  if (action === "dropDatabase") {
    if (!confirmName || confirmName !== database) {
      throw new Error("Type the database name to confirm drop.");
    }
  }

  return {
    action,
    database,
    schema,
    table,
    kind,
    collection,
    newName,
    columns,
    column,
    columnName,
    confirmDestructive,
    confirmName,
  };
}

export function qualifyManageTable(
  engine: Engine,
  parts: { database?: string; schema?: string; table: string },
): string {
  return qualifyTable(engine, {
    database: engine === "mysql" ? parts.database : undefined,
    schema: engine === "mysql" ? undefined : parts.schema,
    table: parts.table,
  });
}

export function buildCreateTableSql(engine: Engine, req: ManageRequest): string {
  if (!req.table) throw new Error("Table name is required.");
  if (!req.columns?.length) throw new Error("Add at least one column.");
  const qualified = qualifyManageTable(engine, {
    database: req.database,
    schema: req.schema || defaultSchemaFor(engine),
    table: req.table,
  });
  const lines = req.columns.map((col) => {
    const nullSql = col.nullable && !col.primaryKey ? "NULL" : "NOT NULL";
    return `  ${quoteIdent(engine, col.name)} ${nativeSqlType(engine, col.type)} ${nullSql}`;
  });
  const pk = req.columns.filter((col) => col.primaryKey).map((col) => quoteIdent(engine, col.name));
  if (pk.length) {
    lines.push(`  PRIMARY KEY (${pk.join(", ")})`);
  }
  return `CREATE TABLE ${qualified} (\n${lines.join(",\n")}\n)`;
}

export function buildDropTableSql(engine: Engine, req: ManageRequest): string {
  if (!req.table) throw new Error("Table name is required.");
  const qualified = qualifyManageTable(engine, {
    database: req.database,
    schema: req.schema || defaultSchemaFor(engine),
    table: req.table,
  });
  const object = req.kind === "view" ? "VIEW" : "TABLE";
  return `DROP ${object} IF EXISTS ${qualified}`;
}

export function buildRenameTableSql(engine: Engine, req: ManageRequest): string {
  if (!req.table) throw new Error("Table name is required.");
  if (!req.newName) throw new Error("New table name is required.");
  const schema = req.schema || defaultSchemaFor(engine);
  if (engine === "postgres") {
    const qualified = qualifyManageTable(engine, { schema, table: req.table });
    return `ALTER TABLE ${qualified} RENAME TO ${quoteIdent(engine, req.newName)}`;
  }
  if (engine === "mysql") {
    const from = qualifyManageTable(engine, { database: req.database, table: req.table });
    const to = qualifyManageTable(engine, { database: req.database, table: req.newName });
    return `RENAME TABLE ${from} TO ${to}`;
  }
  const current = `${schema ? `${schema}.` : ""}${req.table}`;
  return `EXEC sp_rename ${mssqlNString(current)}, ${mssqlNString(req.newName)}`;
}

export function buildAddColumnSql(engine: Engine, req: ManageRequest): string {
  if (!req.table) throw new Error("Table name is required.");
  if (!req.column) throw new Error("Column definition is required.");
  const qualified = qualifyManageTable(engine, {
    database: req.database,
    schema: req.schema || defaultSchemaFor(engine),
    table: req.table,
  });
  const nullSql = req.column.nullable ? "NULL" : "NOT NULL";
  const add = engine === "mssql" ? "ADD" : "ADD COLUMN";
  return `ALTER TABLE ${qualified} ${add} ${quoteIdent(engine, req.column.name)} ${nativeSqlType(engine, req.column.type)} ${nullSql}`;
}

export function buildDropColumnSql(engine: Engine, req: ManageRequest): string {
  if (!req.table) throw new Error("Table name is required.");
  if (!req.columnName) throw new Error("Column name is required.");
  const qualified = qualifyManageTable(engine, {
    database: req.database,
    schema: req.schema || defaultSchemaFor(engine),
    table: req.table,
  });
  return `ALTER TABLE ${qualified} DROP COLUMN ${quoteIdent(engine, req.columnName)}`;
}

export function buildCreateDatabaseSql(engine: Engine, name: string): string {
  if (engine === "mongo") throw new Error("MongoDB does not use CREATE DATABASE.");
  return `CREATE DATABASE ${quoteIdent(engine, name)}`;
}

export function buildDropDatabaseSql(engine: Engine, name: string): string {
  if (engine === "mongo") throw new Error("MongoDB does not use DROP DATABASE SQL.");
  return `DROP DATABASE IF EXISTS ${quoteIdent(engine, name)}`;
}

export function buildRenameDatabaseSql(engine: Engine, name: string, newName: string): string {
  if (!supportsRenameDatabase(engine)) {
    throw new Error(
      engine === "mysql"
        ? "MySQL does not support renaming databases."
        : "This engine does not support renaming databases.",
    );
  }
  if (engine === "postgres") {
    return `ALTER DATABASE ${quoteIdent(engine, name)} RENAME TO ${quoteIdent(engine, newName)}`;
  }
  return `ALTER DATABASE ${quoteIdent(engine, name)} MODIFY NAME = ${quoteIdent(engine, newName)}`;
}

function mssqlNString(value: string): string {
  return `N'${value.replace(/'/g, "''")}'`;
}
