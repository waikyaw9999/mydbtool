import "server-only";

import type { ResolvedConnection } from "@/lib/connections/types";
import { sanitizeError } from "@/lib/db/serialize";
import type {
  ColumnMeta,
  MongoQueryBody,
  PreviewTarget,
  QueryResult,
  SchemaNode,
  TestResult,
} from "@/lib/db/types";
import {
  listMongoObjects,
  previewMongo,
  queryMongo,
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
      return listMssqlObjects(conn);
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
): Promise<QueryResult> {
  switch (conn.engine) {
    case "postgres":
      return queryPostgres(conn, sql, limit);
    case "mysql":
      return queryMysql(conn, sql, limit);
    case "mssql":
      return queryMssql(conn, sql, limit);
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
