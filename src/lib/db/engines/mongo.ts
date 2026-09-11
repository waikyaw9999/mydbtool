import { MongoClient, type Document, type Sort } from "mongodb";

import { optionFlag, parseOptions } from "@/lib/connections/validation";
import type { ResolvedConnection } from "@/lib/connections/types";
import { assertSafeMongoIdent } from "@/lib/db/identifiers";
import { QUERY_TIMEOUT_MS, TEST_TIMEOUT_MS, clampLimit, clampOffset } from "@/lib/db/query-safety";
import { rowsFromRecords, serializeValue } from "@/lib/db/serialize";
import type { ColumnMeta, MongoQueryBody, PreviewTarget, QueryResult, SchemaNode, TestResult } from "@/lib/db/types";

function buildUri(conn: ResolvedConnection): string {
  const options = parseOptions(conn.options);
  const auth =
    conn.username
      ? `${encodeURIComponent(conn.username)}:${encodeURIComponent(conn.password)}@`
      : "";
  const params = new URLSearchParams();
  if (options.authSource) params.set("authSource", options.authSource);
  else if (conn.username && conn.database) params.set("authSource", conn.database);
  if (options.replicaSet) params.set("replicaSet", options.replicaSet);
  if (options.authMechanism) params.set("authMechanism", options.authMechanism);
  if (conn.ssl || optionFlag(options, "tls") || optionFlag(options, "ssl")) {
    params.set("tls", "true");
  }
  if (optionFlag(options, "tlsAllowInvalidCertificates") ?? optionFlag(options, "rejectUnauthorized") === false) {
    params.set("tlsAllowInvalidCertificates", "true");
  }
  const query = params.toString();
  const dbPath = conn.database ? `/${encodeURIComponent(conn.database)}` : "/";
  return `mongodb://${auth}${conn.host}:${conn.port}${dbPath}${query ? `?${query}` : ""}`;
}

async function withClient<T>(
  conn: ResolvedConnection,
  fn: (client: MongoClient) => Promise<T>,
): Promise<T> {
  const client = new MongoClient(buildUri(conn), {
    serverSelectionTimeoutMS: TEST_TIMEOUT_MS,
    connectTimeoutMS: TEST_TIMEOUT_MS,
    socketTimeoutMS: QUERY_TIMEOUT_MS,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function testMongo(conn: ResolvedConnection): Promise<TestResult> {
  const started = Date.now();
  await withClient(conn, async (client) => {
    await client.db(conn.database || "admin").command({ ping: 1 });
  });
  return {
    ok: true,
    message: `Connected to MongoDB${conn.database ? ` / ${conn.database}` : ""}.`,
    latencyMs: Date.now() - started,
    engine: "mongo",
  };
}

export async function listMongoObjects(conn: ResolvedConnection): Promise<SchemaNode[]> {
  return withClient(conn, async (client) => {
    let dbNames: string[] = [];
    try {
      const listed = await client.db("admin").admin().listDatabases();
      dbNames = listed.databases
        .map((db) => db.name)
        .filter((name) => name !== "local" && name !== "config");
    } catch {
      dbNames = conn.database ? [conn.database] : [];
    }
    if (conn.database && !dbNames.includes(conn.database)) {
      dbNames.push(conn.database);
    }

    const nodes: SchemaNode[] = [];
    for (const name of dbNames.sort()) {
      const collections = await client.db(name).listCollections().toArray();
      nodes.push({
        kind: "database",
        name,
        children: collections
          .map((col) => col.name)
          .sort()
          .map((colName) => ({ kind: "collection" as const, name: colName })),
      });
    }
    return nodes;
  });
}

function inferFields(docs: Document[]): ColumnMeta[] {
  const types = new Map<string, Set<string>>();
  for (const doc of docs) {
    for (const [key, value] of Object.entries(doc)) {
      let type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
      if (value instanceof Date) type = "date";
      if (value && typeof value === "object" && "_bsontype" in value) {
        type = String((value as { _bsontype?: string })._bsontype ?? "object");
      }
      if (!types.has(key)) types.set(key, new Set());
      types.get(key)?.add(type);
    }
  }
  return [...types.entries()].map(([name, set]) => ({
    name,
    type: [...set].join(" | "),
  }));
}

export async function previewMongo(
  conn: ResolvedConnection,
  target: PreviewTarget,
  limit: number,
  offset: number,
): Promise<QueryResult> {
  const database = target.database || conn.database;
  const collection = target.collection;
  if (!database) throw new Error("Select a database.");
  if (!collection) throw new Error("Select a collection to preview.");
  assertSafeMongoIdent(database, "database");
  assertSafeMongoIdent(collection, "collection");
  const take = clampLimit(limit);
  const skip = clampOffset(offset);
  return withClient(conn, async (client) => {
    const started = Date.now();
    const col = client.db(database).collection(collection);
    const docs = await col.find({}).skip(skip).limit(take + 1).toArray();
    const truncated = docs.length > take;
    const page = truncated ? docs.slice(0, take) : docs;
    const records = page.map((doc) => serializeValue(doc) as Record<string, unknown>);
    const { columns, rows } = rowsFromRecords(records);
    return {
      columns,
      rows,
      rowCount: rows.length,
      truncated,
      durationMs: Date.now() - started,
      command: "find",
      columnsMeta: inferFields(page),
    };
  });
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (value === undefined || value === null || value === "") return {};
  const parsed =
    typeof value === "string" ? (value.trim() ? JSON.parse(value) : {}) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function asPipeline(value: unknown): Document[] {
  if (value === undefined || value === null || value === "") return [];
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(parsed)) {
    throw new Error("Aggregation pipeline must be a JSON array.");
  }
  return parsed as Document[];
}

export async function queryMongo(
  conn: ResolvedConnection,
  body: MongoQueryBody,
  limit: number,
  offset: number,
): Promise<QueryResult> {
  if (conn.readOnly && body.mode !== "find" && body.mode !== "aggregate") {
    throw new Error("Connection is read-only. Only find and aggregate are allowed.");
  }
  const database = body.database || conn.database;
  if (!database) throw new Error("Database is required.");
  assertSafeMongoIdent(database, "database");
  assertSafeMongoIdent(body.collection, "collection");
  const take = clampLimit(limit);
  const skip = clampOffset(offset);

  return withClient(conn, async (client) => {
    const started = Date.now();
    const col = client.db(database).collection(body.collection);
    let docs: Document[] = [];
    if (body.mode === "aggregate") {
      const pipeline = asPipeline(body.pipeline);
      const hasLimit = pipeline.some((stage) => stage && typeof stage === "object" && "$limit" in stage);
      const hasSkip = pipeline.some((stage) => stage && typeof stage === "object" && "$skip" in stage);
      if (!hasSkip && skip) pipeline.push({ $skip: skip });
      if (!hasLimit) pipeline.push({ $limit: take + 1 });
      docs = await col.aggregate(pipeline, { maxTimeMS: QUERY_TIMEOUT_MS }).toArray();
    } else {
      const filter = asObject(body.filter, "Filter");
      const projection = body.projection ? asObject(body.projection, "Projection") : undefined;
      const sort = body.sort ? (asObject(body.sort, "Sort") as Sort) : undefined;
      let cursor = col.find(filter, { projection, maxTimeMS: QUERY_TIMEOUT_MS });
      if (sort) cursor = cursor.sort(sort);
      docs = await cursor.skip(skip).limit(take + 1).toArray();
    }
    const truncated = docs.length > take;
    const page = truncated ? docs.slice(0, take) : docs;
    const records = page.map((doc) => serializeValue(doc) as Record<string, unknown>);
    const { columns, rows } = rowsFromRecords(records);
    return {
      columns,
      rows,
      rowCount: rows.length,
      truncated,
      durationMs: Date.now() - started,
      command: body.mode,
      columnsMeta: inferFields(page),
    };
  });
}
