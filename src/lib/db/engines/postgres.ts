import { Client, type ClientConfig } from "pg";

import { optionFlag, parseOptions } from "@/lib/connections/validation";
import type { ResolvedConnection } from "@/lib/connections/types";
import { qualifyTable } from "@/lib/db/identifiers";
import { QUERY_TIMEOUT_MS, TEST_TIMEOUT_MS, clampLimit, clampOffset } from "@/lib/db/query-safety";
import { rowsFromRecords } from "@/lib/db/serialize";
import type { ColumnMeta, PreviewTarget, QueryResult, SchemaNode, TestResult } from "@/lib/db/types";

function configFor(conn: ResolvedConnection, database = conn.database): ClientConfig {
  const options = parseOptions(conn.options);
  const rejectUnauthorized = optionFlag(options, "rejectUnauthorized");
  return {
    host: conn.host,
    port: conn.port,
    user: conn.username || undefined,
    password: conn.password || undefined,
    database: database || "postgres",
    connectionTimeoutMillis: TEST_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
    ssl: conn.ssl
      ? { rejectUnauthorized: rejectUnauthorized ?? false }
      : undefined,
  };
}

async function withClient<T>(
  conn: ResolvedConnection,
  database: string | undefined,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client(configFor(conn, database || conn.database));
  await client.connect();
  try {
    if (conn.readOnly) {
      await client.query("SET default_transaction_read_only = on");
    }
    await client.query(`SET statement_timeout = ${QUERY_TIMEOUT_MS}`);
    return await fn(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function testPostgres(conn: ResolvedConnection): Promise<TestResult> {
  const started = Date.now();
  await withClient(conn, conn.database, async (client) => {
    await client.query("SELECT 1");
  });
  return {
    ok: true,
    message: `Connected to PostgreSQL${conn.database ? ` / ${conn.database}` : ""}.`,
    latencyMs: Date.now() - started,
    engine: "postgres",
  };
}

export async function listPostgresObjects(
  conn: ResolvedConnection,
  focusDatabase?: string,
): Promise<SchemaNode[]> {
  return withClient(conn, conn.database, async (client) => {
    let databases: string[] = [];
    try {
      const dbRes = await client.query<{ datname: string }>(
        "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname",
      );
      databases = dbRes.rows.map((row) => row.datname);
    } catch {
      databases = conn.database ? [conn.database] : [];
    }

    const current = focusDatabase || conn.database;
    if (current && !databases.includes(current)) {
      databases = [current, ...databases];
    }
    const nodes: SchemaNode[] = [];

    for (const dbName of databases) {
      if (dbName !== current) {
        nodes.push({ kind: "database", name: dbName, children: [] });
        continue;
      }

      const tableClient =
        dbName === (conn.database || "postgres")
          ? client
          : new Client(configFor(conn, dbName));
      const openedExtra = tableClient !== client;
      if (openedExtra) await tableClient.connect();
      try {
        const tables = await tableClient.query<{
          table_schema: string;
          table_name: string;
          table_type: string;
        }>(
          `SELECT table_schema, table_name, table_type
           FROM information_schema.tables
           WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
           ORDER BY table_schema, table_name`,
        );
        const schemas = new Map<string, SchemaNode>();
        for (const row of tables.rows) {
          let schema = schemas.get(row.table_schema);
          if (!schema) {
            schema = { kind: "schema", name: row.table_schema, children: [] };
            schemas.set(row.table_schema, schema);
          }
          schema.children?.push({
            kind: row.table_type === "VIEW" ? "view" : "table",
            name: row.table_name,
          });
        }
        nodes.push({
          kind: "database",
          name: dbName,
          children: [...schemas.values()],
        });
      } finally {
        if (openedExtra) await tableClient.end().catch(() => undefined);
      }
    }

    if (nodes.length === 0 && current) {
      nodes.push({ kind: "database", name: current, children: [] });
    }
    return nodes;
  });
}

export async function postgresColumns(
  conn: ResolvedConnection,
  target: PreviewTarget,
): Promise<ColumnMeta[]> {
  const database = target.database || conn.database;
  const schema = target.schema || "public";
  const table = target.table;
  if (!table) return [];
  return withClient(conn, database, async (client) => {
    const res = await client.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
      character_maximum_length: number | null;
    }>(
      `SELECT column_name, data_type, is_nullable, column_default, character_maximum_length
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
       ORDER BY ordinal_position`,
      [schema, table],
    );
    return res.rows.map((row) => ({
      name: row.column_name,
      type: row.character_maximum_length
        ? `${row.data_type}(${row.character_maximum_length})`
        : row.data_type,
      nullable: row.is_nullable === "YES",
      defaultValue: row.column_default,
    }));
  });
}

export async function previewPostgres(
  conn: ResolvedConnection,
  target: PreviewTarget,
  limit: number,
  offset: number,
): Promise<QueryResult> {
  if (!target.table) throw new Error("Select a table to preview.");
  const database = target.database || conn.database;
  const qualified = qualifyTable("postgres", {
    schema: target.schema || "public",
    table: target.table,
  });
  const take = clampLimit(limit);
  const skip = clampOffset(offset);
  return withClient(conn, database, async (client) => {
    const started = Date.now();
    const res = await client.query(
      `SELECT * FROM ${qualified} LIMIT $1 OFFSET $2`,
      [take + 1, skip],
    );
    const truncated = res.rows.length > take;
    const records = (truncated ? res.rows.slice(0, take) : res.rows) as Array<
      Record<string, unknown>
    >;
    const { columns, rows } = rowsFromRecords(records);
    const columnsMeta = await postgresColumns(conn, target);
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

export async function queryPostgres(
  conn: ResolvedConnection,
  sql: string,
  limit: number,
  database = conn.database,
): Promise<QueryResult> {
  const take = clampLimit(limit);
  return withClient(conn, database, async (client) => {
    const started = Date.now();
    const res = await client.query(sql);
    const records = Array.isArray(res.rows)
      ? (res.rows as Array<Record<string, unknown>>)
      : [];
    const truncated = records.length > take;
    const sliced = truncated ? records.slice(0, take) : records;
    const { columns, rows } = rowsFromRecords(sliced);
    return {
      columns,
      rows,
      rowCount: typeof res.rowCount === "number" ? res.rowCount : rows.length,
      truncated,
      durationMs: Date.now() - started,
      command: res.command,
      affectedRows: res.command && res.command !== "SELECT" ? res.rowCount ?? 0 : undefined,
    };
  });
}
