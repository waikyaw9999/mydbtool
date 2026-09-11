import type { Engine } from "@/lib/connections/types";

const SQL_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MONGO_IDENT = /^[A-Za-z0-9_$.-]+$/;

export function assertSafeSqlIdent(name: string, label = "identifier"): string {
  if (!name || !SQL_IDENT.test(name)) {
    throw new Error(`Invalid ${label}. Use letters, numbers, and underscores only.`);
  }
  return name;
}

export function assertSafeMongoIdent(name: string, label = "name"): string {
  if (!name || name.startsWith("$") || !MONGO_IDENT.test(name) || name.includes("..")) {
    throw new Error(`Invalid Mongo ${label}.`);
  }
  return name;
}

export function quoteIdent(engine: Engine, name: string): string {
  assertSafeSqlIdent(name);
  switch (engine) {
    case "postgres":
      return `"${name}"`;
    case "mysql":
      return `\`${name}\``;
    case "mssql":
      return `[${name}]`;
    default:
      return name;
  }
}

export function qualifyTable(
  engine: Engine,
  parts: { database?: string; schema?: string; table: string },
): string {
  const chunks: string[] = [];
  if (parts.database && (engine === "mysql" || engine === "mssql")) {
    chunks.push(quoteIdent(engine, parts.database));
  }
  if (parts.schema && engine !== "mysql") {
    chunks.push(quoteIdent(engine, parts.schema));
  }
  chunks.push(quoteIdent(engine, parts.table));
  return chunks.join(".");
}
