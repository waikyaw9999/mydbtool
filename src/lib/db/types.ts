import type { Engine } from "@/lib/connections/types";

export type ObjectKind = "database" | "schema" | "table" | "view" | "collection";

export type SchemaNode = {
  kind: ObjectKind;
  name: string;
  children?: SchemaNode[];
};

export type ColumnMeta = {
  name: string;
  type: string;
  nullable?: boolean;
  defaultValue?: string | null;
};

export type QueryResult = {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  truncated: boolean;
  durationMs: number;
  command?: string;
  affectedRows?: number;
  columnsMeta?: ColumnMeta[];
};

export type TestResult = {
  ok: boolean;
  message: string;
  latencyMs: number;
  engine: Engine;
};

export type PreviewTarget = {
  database?: string;
  schema?: string;
  table?: string;
  collection?: string;
};

export type MongoQueryBody = {
  database?: string;
  collection: string;
  mode: "find" | "aggregate";
  filter?: unknown;
  pipeline?: unknown;
  projection?: unknown;
  sort?: unknown;
};

export type QueryRequest = {
  sql?: string;
  /** SQL catalog to open for this statement; defaults to the saved connection database. */
  database?: string;
  mongo?: MongoQueryBody;
  limit?: number;
  offset?: number;
  confirmDestructive?: boolean;
};

export type QueryResponse =
  | (QueryResult & { needsConfirmation?: false })
  | {
      needsConfirmation: true;
      reason: string;
      keywords: string[];
    };
