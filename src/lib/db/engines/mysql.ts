import mysql, { type Connection, type ConnectionOptions, type RowDataPacket } from "mysql2/promise";

import { optionFlag, parseOptions } from "@/lib/connections/validation";
import type { ResolvedConnection } from "@/lib/connections/types";
import { qualifyTable } from "@/lib/db/identifiers";
import { QUERY_TIMEOUT_MS, TEST_TIMEOUT_MS, clampLimit, clampOffset } from "@/lib/db/query-safety";
import { rowsFromRecords } from "@/lib/db/serialize";
import type { ColumnMeta, PreviewTarget, QueryResult, SchemaNode, TestResult } from "@/lib/db/types";

function configFor(conn: ResolvedConnection, database = conn.database): ConnectionOptions {
  const options = parseOptions(conn.options);
  const rejectUnauthorized = optionFlag(options, "rejectUnauthorized");
  return {
    host: conn.host,
    port: conn.port,
    user: conn.username || undefined,
    password: conn.password || undefined,
    database: database || undefined,
    connectTimeout: TEST_TIMEOUT_MS,
    ssl: conn.ssl ? { rejectUnauthorized: rejectUnauthorized ?? false } : undefined,
    multipleStatements: false,
  };
}

async function withConn<T>(
  conn: ResolvedConnection,
  fn: (client: Connection) => Promise<T>,
  database?: string,
): Promise<T> {
  const client = await mysql.createConnection(configFor(conn, database || conn.database));
  try {
    if (conn.readOnly) {
      await client.query("SET SESSION TRANSACTION READ ONLY");
    }
    await client.query(`SET SESSION max_execution_time = ${QUERY_TIMEOUT_MS}`).catch(() => undefined);
    return await fn(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function testMysql(conn: ResolvedConnection): Promise<TestResult> {
  const started = Date.now();
  await withConn(conn, async (client) => {
    await client.query("SELECT 1");
  });
  return {
    ok: true,
    message: `Connected to MySQL${conn.database ? ` / ${conn.database}` : ""}.`,
    latencyMs: Date.now() - started,
    engine: "mysql",
  };
}

export async function listMysqlObjects(conn: ResolvedConnection): Promise<SchemaNode[]> {
  return withConn(conn, async (client) => {
    const [dbRows] = await client.query<RowDataPacket[]>(
      `SELECT schema_name AS name
       FROM information_schema.schemata
       WHERE schema_name NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
       ORDER BY schema_name`,
    );
    const [tableRows] = await client.query<RowDataPacket[]>(
      `SELECT table_schema, table_name, table_type
       FROM information_schema.tables
       WHERE table_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
       ORDER BY table_schema, table_name`,
    );

    const dbs = new Map<string, SchemaNode>();
    for (const row of dbRows) {
      dbs.set(String(row.name), { kind: "database", name: String(row.name), children: [] });
    }
    for (const row of tableRows) {
      const dbName = String(row.table_schema);
      let db = dbs.get(dbName);
      if (!db) {
        db = { kind: "database", name: dbName, children: [] };
        dbs.set(dbName, db);
      }
      db.children?.push({
        kind: row.table_type === "VIEW" ? "view" : "table",
        name: String(row.table_name),
      });
    }
    return [...dbs.values()];
  });
}

export async function mysqlColumns(
  conn: ResolvedConnection,
  target: PreviewTarget,
): Promise<ColumnMeta[]> {
  const schema = target.database || target.schema || conn.database;
  const table = target.table;
  if (!schema || !table) return [];
  return withConn(conn, async (client) => {
    const [rows] = await client.query<RowDataPacket[]>(
      `SELECT column_name, column_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = ? AND table_name = ?
       ORDER BY ordinal_position`,
      [schema, table],
    );
    return rows.map((row) => ({
      name: String(row.column_name),
      type: String(row.column_type),
      nullable: row.is_nullable === "YES",
      defaultValue: row.column_default == null ? null : String(row.column_default),
    }));
  });
}

export async function previewMysql(
  conn: ResolvedConnection,
  target: PreviewTarget,
  limit: number,
  offset: number,
): Promise<QueryResult> {
  if (!target.table) throw new Error("Select a table to preview.");
  const database = target.database || target.schema || conn.database;
  const qualified = qualifyTable("mysql", { database, table: target.table });
  const take = clampLimit(limit);
  const skip = clampOffset(offset);
  return withConn(conn, async (client) => {
    const started = Date.now();
    const [raw] = await client.query<RowDataPacket[]>(
      `SELECT * FROM ${qualified} LIMIT ? OFFSET ?`,
      [take + 1, skip],
    );
    const truncated = raw.length > take;
    const records = (truncated ? raw.slice(0, take) : raw) as Array<Record<string, unknown>>;
    const { columns, rows } = rowsFromRecords(records);
    const columnsMeta = await mysqlColumns(conn, { ...target, database });
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

export async function queryMysql(
  conn: ResolvedConnection,
  sql: string,
  limit: number,
  database = conn.database,
): Promise<QueryResult> {
  const take = clampLimit(limit);
  return withConn(
    conn,
    async (client) => {
      const started = Date.now();
      const [raw, fields] = await client.query(sql);
      const durationMs = Date.now() - started;
      if (Array.isArray(raw)) {
        const records = raw as Array<Record<string, unknown>>;
        const truncated = records.length > take;
        const sliced = truncated ? records.slice(0, take) : records;
        const { columns, rows } = rowsFromRecords(
          sliced,
          Array.isArray(fields) ? fields.map((field) => field.name) : [],
        );
        return {
          columns,
          rows,
          rowCount: records.length,
          truncated,
          durationMs,
          command: "SELECT",
        };
      }
      const header = raw as { affectedRows?: number };
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        truncated: false,
        durationMs,
        command: "OK",
        affectedRows: header.affectedRows,
      };
    },
    database,
  );
}
