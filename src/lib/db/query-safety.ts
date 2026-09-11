export type SqlKind = "read" | "write" | "unknown";

export type SqlAnalysis = {
  kind: SqlKind;
  destructive: boolean;
  destructiveKeywords: string[];
  writeKeywords: string[];
  stripped: string;
};

const WRITE_KEYWORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "TRUNCATE",
  "ALTER",
  "CREATE",
  "GRANT",
  "REVOKE",
  "REPLACE",
  "MERGE",
  "COPY",
  "VACUUM",
  "REINDEX",
  "CLUSTER",
  "RENAME",
  "COMMENT",
] as const;

const DESTRUCTIVE_KEYWORDS = ["DELETE", "DROP", "TRUNCATE", "ALTER"] as const;

export function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findKeywords(sql: string, keywords: readonly string[]): string[] {
  const found = new Set<string>();
  for (const keyword of keywords) {
    const re = new RegExp(`\\b${keyword}\\b`, "i");
    if (re.test(sql)) found.add(keyword);
  }
  return [...found];
}

export function analyzeSql(sql: string): SqlAnalysis {
  const stripped = stripSqlComments(sql);
  if (!stripped) {
    return {
      kind: "unknown",
      destructive: false,
      destructiveKeywords: [],
      writeKeywords: [],
      stripped,
    };
  }

  const writeKeywords = findKeywords(stripped, WRITE_KEYWORDS);
  const destructiveKeywords = findKeywords(stripped, DESTRUCTIVE_KEYWORDS);
  const kind: SqlKind = writeKeywords.length > 0 ? "write" : "read";

  return {
    kind,
    destructive: destructiveKeywords.length > 0,
    destructiveKeywords,
    writeKeywords,
    stripped,
  };
}

export function assertSqlAllowed(sql: string, readOnly: boolean): SqlAnalysis {
  const analysis = analyzeSql(sql);
  if (!analysis.stripped) {
    throw new Error("Query is empty.");
  }
  if (readOnly && analysis.kind === "write") {
    throw new Error(
      `Connection is read-only. Blocked keyword(s): ${analysis.writeKeywords.join(", ")}.`,
    );
  }
  return analysis;
}

export type MongoQueryMode = "find" | "aggregate";

export function isMongoQueryMode(value: unknown): value is MongoQueryMode {
  return value === "find" || value === "aggregate";
}

export function analyzeMongoMode(mode: string): {
  readOnly: boolean;
  destructive: boolean;
} {
  if (mode === "find" || mode === "aggregate") {
    return { readOnly: true, destructive: false };
  }
  if (mode === "deleteMany" || mode === "deleteOne" || mode === "drop") {
    return { readOnly: false, destructive: true };
  }
  return { readOnly: false, destructive: false };
}

export function assertMongoAllowed(mode: string, readOnly: boolean): void {
  if (!isMongoQueryMode(mode)) {
    throw new Error("Mongo queries support find and aggregate only.");
  }
  const analysis = analyzeMongoMode(mode);
  if (readOnly && !analysis.readOnly) {
    throw new Error("Connection is read-only. Only find and aggregate are allowed.");
  }
}

export const DEFAULT_RESULT_LIMIT = 100;
export const MAX_RESULT_LIMIT = 500;
export const TEST_TIMEOUT_MS = 8000;
export const QUERY_TIMEOUT_MS = 30000;

export function clampLimit(value: unknown, fallback = DEFAULT_RESULT_LIMIT): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_RESULT_LIMIT, Math.max(1, Math.floor(n)));
}

export function clampOffset(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}
