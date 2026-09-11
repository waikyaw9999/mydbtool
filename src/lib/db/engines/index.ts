import "server-only";

import type { ResolvedConnection } from "@/lib/connections/types";
import { sanitizeError } from "@/lib/db/serialize";
import { resolveQueryDatabase } from "@/lib/db/sql-database";
import {
  buildAddColumnSql,
  buildCreateDatabaseSql,
  buildCreateTableSql,
  buildDropColumnSql,
  buildDropDatabaseSql,
  buildDropTableSql,
  buildRenameDatabaseSql,
  buildRenameTableSql,
  DEFAULT_MONGO_INIT_COLLECTION,
  assertDroppableDatabase,
  assertMutableCatalog,
  defaultSchemaFor,
  isDestructiveManageAction,
  maintenanceDatabaseFor,
  supportsRenameDatabase,
  type ManageRequest,
} from "@/lib/db/ddl";
import type {
  ColumnMeta,
  MongoQueryBody,
  PreviewTarget,
  QueryResult,
  SchemaNode,
  TestResult,
} from "@/lib/db/types";
import {
  createMongoCollection,
  createMongoDatabase,
  dropMongoCollection,
  dropMongoDatabase,
  listMongoObjects,
  previewMongo,
  queryMongo,
  renameMongoCollection,
  testMongo,
} from "./mongo";
import {
  listMssqlObjects,
  mssqlColumns,
  previewMssql,
  queryMssql,
  testMssql,
} from "./mssql";
import {
  listMysqlObjects,
  mysqlColumns,
  previewMysql,
  queryMysql,
  testMysql,
} from "./mysql";
import {
  listPostgresObjects,
  postgresColumns,
  previewPostgres,
  queryPostgres,
  testPostgres,
} from "./postgres";

export async function testConnection(conn: ResolvedConnection): Promise<TestResult> {
  try {
    switch (conn.engine) {
      case "postgres":
        return await testPostgres(conn);
      case "mysql":
        return await testMysql(conn);
      case "mssql":
        return await testMssql(conn);
      case "mongo":
        return await testMongo(conn);
    }
  } catch (err) {
    return {
      ok: false,
      message: sanitizeError(err),
      latencyMs: 0,
      engine: conn.engine,
    };
  }
}

export async function listObjects(
  conn: ResolvedConnection,
  focusDatabase?: string,
): Promise<SchemaNode[]> {
  switch (conn.engine) {
    case "postgres":
      return listPostgresObjects(conn, focusDatabase);
    case "mysql":
      return listMysqlObjects(conn);
    case "mssql":
      return listMssqlObjects(conn, focusDatabase);
    case "mongo":
      return listMongoObjects(conn);
  }
}

export async function previewObjects(
  conn: ResolvedConnection,
  target: PreviewTarget,
  limit: number,
  offset: number,
): Promise<QueryResult> {
  switch (conn.engine) {
    case "postgres":
      return previewPostgres(conn, target, limit, offset);
    case "mysql":
      return previewMysql(conn, target, limit, offset);
    case "mssql":
      return previewMssql(conn, target, limit, offset);
    case "mongo":
      return previewMongo(conn, target, limit, offset);
  }
}

export async function runSql(
  conn: ResolvedConnection,
  sql: string,
  limit: number,
  database?: string,
): Promise<QueryResult> {
  const targetDb = resolveQueryDatabase(conn.database, database);
  switch (conn.engine) {
    case "postgres":
      return queryPostgres(conn, sql, limit, targetDb);
    case "mysql":
      return queryMysql(conn, sql, limit, targetDb);
    case "mssql":
      return queryMssql(conn, sql, limit, targetDb);
    case "mongo":
      throw new Error("Use a Mongo find or aggregation instead of SQL.");
  }
}

export async function runMongo(
  conn: ResolvedConnection,
  body: MongoQueryBody,
  limit: number,
  offset: number,
): Promise<QueryResult> {
  if (conn.engine !== "mongo") {
    throw new Error("Mongo queries are only available on MongoDB connections.");
  }
  return queryMongo(conn, body, limit, offset);
}

export async function describeColumns(
  conn: ResolvedConnection,
  target: PreviewTarget,
): Promise<ColumnMeta[]> {
  switch (conn.engine) {
    case "postgres":
      return postgresColumns(conn, target);
    case "mysql":
      return mysqlColumns(conn, target);
    case "mssql":
      return mssqlColumns(conn, target);
    case "mongo":
      return [];
  }
}

export async function runManage(
  conn: ResolvedConnection,
  req: ManageRequest,
): Promise<{ message: string }> {
  if (conn.readOnly) {
    throw new Error("Connection is read-only. Object changes are blocked.");
  }
  if (isDestructiveManageAction(req.action) && !req.confirmDestructive) {
    throw new Error("Confirm this destructive action to continue.");
  }

  if (conn.engine === "mongo") {
    const database = req.database || conn.database;
    if (!database) throw new Error("Database is required.");
    if (req.action === "createDatabase") {
      const collection = req.collection || DEFAULT_MONGO_INIT_COLLECTION;
      await createMongoDatabase(conn, database, collection);
      return { message: `Created database ${database} (collection ${collection}).` };
    }
    if (req.action === "dropDatabase") {
      assertDroppableDatabase("mongo", database, conn.database);
      await dropMongoDatabase(conn, database);
      return { message: `Dropped database ${database}.` };
    }
    if (req.action === "renameDatabase") {
      throw new Error("MongoDB does not support renaming databases. Create a new one and copy collections if needed.");
    }
    if (!req.collection && req.action !== "createCollection") {
      throw new Error("Collection name is required.");
    }
    if (req.action === "createCollection") {
      if (!req.collection) throw new Error("Collection name is required.");
      await createMongoCollection(conn, database, req.collection);
      return { message: `Created collection ${database}.${req.collection}.` };
    }
    if (req.action === "dropCollection") {
      await dropMongoCollection(conn, database, req.collection!);
      return { message: `Dropped collection ${database}.${req.collection}.` };
    }
    if (req.action === "renameCollection") {
      if (!req.newName) throw new Error("New collection name is required.");
      await renameMongoCollection(conn, database, req.collection!, req.newName);
      return { message: `Renamed collection to ${req.newName}.` };
    }
    throw new Error("That action is not available on MongoDB connections.");
  }

  if (req.action === "createDatabase") {
    if (!req.database) throw new Error("Database name is required.");
    const sql = buildCreateDatabaseSql(conn.engine, req.database);
    const maintenance = maintenanceDatabaseFor(conn.engine, req.database, conn.database);
    await runSql(conn, sql, 1, maintenance);
    return { message: `Created database ${req.database}.` };
  }
  if (req.action === "dropDatabase") {
    if (!req.database) throw new Error("Database name is required.");
    assertDroppableDatabase(conn.engine, req.database, conn.database);
    const sql = buildDropDatabaseSql(conn.engine, req.database);
    const maintenance = maintenanceDatabaseFor(conn.engine, req.database, conn.database);
    await runSql(conn, sql, 1, maintenance);
    return { message: `Dropped database ${req.database}.` };
  }
  if (req.action === "renameDatabase") {
    if (!req.database) throw new Error("Database name is required.");
    if (!req.newName) throw new Error("New database name is required.");
    if (!supportsRenameDatabase(conn.engine)) {
      throw new Error("This engine does not support renaming databases.");
    }
    assertMutableCatalog(conn.engine, req.database, conn.database, "rename");
    const sql = buildRenameDatabaseSql(conn.engine, req.database, req.newName);
    const maintenance = maintenanceDatabaseFor(conn.engine, req.database, conn.database);
    await runSql(conn, sql, 1, maintenance);
    return { message: `Renamed database to ${req.newName}.` };
  }

  const database = req.database || conn.database;
  const withDefaults: ManageRequest = {
    ...req,
    database,
    schema: req.schema || defaultSchemaFor(conn.engine),
  };

  let sql: string;
  let message: string;
  switch (req.action) {
    case "createTable":
      sql = buildCreateTableSql(conn.engine, withDefaults);
      message = `Created table ${withDefaults.schema ? `${withDefaults.schema}.` : ""}${req.table}.`;
      break;
    case "dropTable":
      sql = buildDropTableSql(conn.engine, withDefaults);
      message = `Dropped ${req.kind === "view" ? "view" : "table"} ${req.table}.`;
      break;
    case "renameTable":
      sql = buildRenameTableSql(conn.engine, withDefaults);
      message = `Renamed table to ${req.newName}.`;
      break;
    case "addColumn":
      sql = buildAddColumnSql(conn.engine, withDefaults);
      message = `Added column ${req.column?.name}.`;
      break;
    case "dropColumn":
      sql = buildDropColumnSql(conn.engine, withDefaults);
      message = `Dropped column ${req.columnName}.`;
      break;
    default:
      throw new Error("That action is not available on SQL connections.");
  }

  await runSql(conn, sql, 1, database);
  return { message };
}
