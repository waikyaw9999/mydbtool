import sql, { type config as MssqlConfig } from "mssql";

import { optionFlag, parseOptions } from "@/lib/connections/validation";
import type { ResolvedConnection } from "@/lib/connections/types";
import { qualifyTable } from "@/lib/db/identifiers";
import { QUERY_TIMEOUT_MS, TEST_TIMEOUT_MS, clampLimit, clampOffset } from "@/lib/db/query-safety";
import { rowsFromRecords } from "@/lib/db/serialize";
import type { ColumnMeta, PreviewTarget, QueryResult, SchemaNode, TestResult } from "@/lib/db/types";

function configFor(conn: ResolvedConnection, database = conn.database): MssqlConfig {
  const options = parseOptions(conn.options);
  const encrypt = optionFlag(options, "encrypt") ?? conn.ssl;
  const trust = optionFlag(options, "trustServerCertificate");
  return {
    server: conn.host,
    port: conn.port,
    user: conn.username || undefined,
    password: conn.password || undefined,
    database: database || undefined,
    connectionTimeout: TEST_TIMEOUT_MS,
    requestTimeout: QUERY_TIMEOUT_MS,
    options: {
      encrypt: Boolean(encrypt),
      trustServerCertificate: trust ?? true,
      enableArithAbort: true,
    },
  };
}

async function withPool<T>(
  conn: ResolvedConnection,
  database: string | undefined,
  fn: (pool: sql.ConnectionPool) => Promise<T>,
): Promise<T> {
  const pool = new sql.ConnectionPool(configFor(conn, database || conn.database));
  await pool.connect();
  try {
    return await fn(pool);
  } finally {
    await pool.close().catch(() => undefined);
  }
}

export async function testMssql(conn: ResolvedConnection): Promise<TestResult> {
  const started = Date.now();
  await withPool(conn, conn.database, async (pool) => {
    await pool.request().query("SELECT 1 AS ok");
  });
  return {
    ok: true,
    message: `Connected to SQL Server${conn.database ? ` / ${conn.database}` : ""}.`,
    latencyMs: Date.now() - started,
    engine: "mssql",
  };
}

export async function listMssqlObjects(conn: ResolvedConnection): Promise<SchemaNode[]> {
  return withPool(conn, conn.database, async (pool) => {
    let databases: string[] = [];
    try {
      const dbRes = await pool.request().query<{ name: string }>(
        "SELECT name FROM sys.databases WHERE name NOT IN ('master', 'tempdb', 'model', 'msdb') ORDER BY name",
      );
      databases = dbRes.recordset.map((row) => row.name);
    } catch {
      databases = conn.database ? [conn.database] : [];
    }

    const tableRes = await pool.request().query<{
      TABLE_CATALOG: string;
      TABLE_SCHEMA: string;
      TABLE_NAME: string;
      TABLE_TYPE: string;
    }>(
      `SELECT TABLE_CATALOG, TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
       FROM INFORMATION_SCHEMA.TABLES
       ORDER BY TABLE_SCHEMA, TABLE_NAME`,
    );

    const nodes = new Map<string, SchemaNode>();
    for (const name of databases) {
      nodes.set(name, { kind: "database", name, children: [] });
    }

    const current = conn.database || tableRes.recordset[0]?.TABLE_CATALOG;
    if (current && !nodes.has(current)) {
      nodes.set(current, { kind: "database", name: current, children: [] });
    }

    const schemas = new Map<string, SchemaNode>();
    for (const row of tableRes.recordset) {
      const dbName = row.TABLE_CATALOG;
      let db = nodes.get(dbName);
      if (!db) {
        db = { kind: "database", name: dbName, children: [] };
        nodes.set(dbName, db);
      }
      const key = `${dbName}.${row.TABLE_SCHEMA}`;
      let schema = schemas.get(key);
      if (!schema) {
        schema = { kind: "schema", name: row.TABLE_SCHEMA, children: [] };
        schemas.set(key, schema);
        db.children?.push(schema);
      }
      schema.children?.push({
        kind: row.TABLE_TYPE === "VIEW" ? "view" : "table",
        name: row.TABLE_NAME,
      });
    }
    return [...nodes.values()];
  });
}

export async function mssqlColumns(
  conn: ResolvedConnection,
  target: PreviewTarget,
): Promise<ColumnMeta[]> {
  const database = target.database || conn.database;
  const schema = target.schema || "dbo";
  const table = target.table;
  if (!table) return [];
  return withPool(conn, database, async (pool) => {
    const res = await pool
      .request()
      .input("schema", sql.NVarChar, schema)
      .input("table", sql.NVarChar, table)
      .query<{
        COLUMN_NAME: string;
        DATA_TYPE: string;
        IS_NULLABLE: string;
        COLUMN_DEFAULT: string | null;
        CHARACTER_MAXIMUM_LENGTH: number | null;
      }>(
        `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, CHARACTER_MAXIMUM_LENGTH
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table
         ORDER BY ORDINAL_POSITION`,
      );
    return res.recordset.map((row) => ({
      name: row.COLUMN_NAME,
      type: row.CHARACTER_MAXIMUM_LENGTH
        ? `${row.DATA_TYPE}(${row.CHARACTER_MAXIMUM_LENGTH})`
        : row.DATA_TYPE,
      nullable: row.IS_NULLABLE === "YES",
      defaultValue: row.COLUMN_DEFAULT,
    }));
  });
}

export async function previewMssql(
  conn: ResolvedConnection,
  target: PreviewTarget,
  limit: number,
  offset: number,
): Promise<QueryResult> {
  if (!target.table) throw new Error("Select a table to preview.");
  const database = target.database || conn.database;
  const qualified = qualifyTable("mssql", {
    database,
    schema: target.schema || "dbo",
    table: target.table,
  });
  const take = clampLimit(limit);
  const skip = clampOffset(offset);
  return withPool(conn, database, async (pool) => {
    const started = Date.now();
    const res = await pool
      .request()
      .input("take", sql.Int, take + 1)
      .input("skip", sql.Int, skip)
      .query(`SELECT * FROM ${qualified} ORDER BY (SELECT NULL) OFFSET @skip ROWS FETCH NEXT @take ROWS ONLY`);
    const truncated = res.recordset.length > take;
    const records = (truncated ? res.recordset.slice(0, take) : res.recordset) as Array<
      Record<string, unknown>
    >;
    const { columns, rows } = rowsFromRecords(records);
    const columnsMeta = await mssqlColumns(conn, { ...target, database });
    return {
      columns,
      rows,
      rowCount: rows.length,
      truncated,
      durationMs: Date.now() - started,
      command: "SELECT",
      columnsMeta,
    };
  });
}

export async function queryMssql(
  conn: ResolvedConnection,
  sqlText: string,
  limit: number,
): Promise<QueryResult> {
  const take = clampLimit(limit);
  return withPool(conn, conn.database, async (pool) => {
    const started = Date.now();
    const res = await pool.request().query(sqlText);
    const records = (res.recordset ?? []) as Array<Record<string, unknown>>;
    const truncated = records.length > take;
    const sliced = truncated ? records.slice(0, take) : records;
    const { columns, rows } = rowsFromRecords(sliced);
    const affected =
      Array.isArray(res.rowsAffected) && res.rowsAffected.length
        ? res.rowsAffected[res.rowsAffected.length - 1]
        : undefined;
    return {
      columns,
      rows,
      rowCount: rows.length,
      truncated,
      durationMs: Date.now() - started,
      command: rows.length ? "SELECT" : "OK",
      affectedRows: rows.length ? undefined : affected,
    };
  });
}
