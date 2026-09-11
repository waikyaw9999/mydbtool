export const MAX_DATABASE_NAME_LENGTH = 128;

/** Pick the SQL catalog to open: request override, else the saved connection database. */
export function resolveQueryDatabase(
  connectionDatabase: string,
  requested?: unknown,
): string {
  if (typeof requested !== "string") return connectionDatabase;
  const name = requested.trim();
  if (!name) return connectionDatabase;
  if (name.length > MAX_DATABASE_NAME_LENGTH) {
    throw new Error("Database name is too long.");
  }
  if (/[\0\r\n]/.test(name)) {
    throw new Error("Invalid database name.");
  }
  return name;
}

/** Catalog names shown in the SQL tab selector (connection default, active tab, tree). */
export function listSqlDatabases(input: {
  connectionDatabase?: string;
  activeDatabase?: string;
  tree?: Array<{ kind: string; name: string }> | null;
}): string[] {
  const names = new Set<string>();
  for (const value of [input.connectionDatabase, input.activeDatabase]) {
    const name = value?.trim();
    if (name) names.add(name);
  }
  for (const node of input.tree ?? []) {
    if (node.kind === "database") {
      const name = node.name?.trim();
      if (name) names.add(name);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}
