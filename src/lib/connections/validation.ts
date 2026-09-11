import {
  DEFAULT_PORTS,
  ENGINES,
  type ConnectionInput,
  type Engine,
} from "./types";

export type ValidationResult =
  | { ok: true; value: ConnectionInput }
  | { ok: false; errors: Record<string, string> };

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function asPort(value: unknown, engine: Engine): number | null {
  if (value === "" || value === undefined || value === null) {
    return DEFAULT_PORTS[engine];
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return null;
  return n;
}

export function isEngine(value: unknown): value is Engine {
  return typeof value === "string" && (ENGINES as readonly string[]).includes(value);
}

export function validateConnectionInput(input: unknown): ValidationResult {
  const errors: Record<string, string> = {};
  const raw =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};

  const name = asString(raw.name);
  if (!name) errors.name = "Name is required.";
  else if (name.length > 80) errors.name = "Name must be 80 characters or fewer.";

  if (!isEngine(raw.engine)) {
    errors.engine = "Choose postgres, mysql, mssql, or mongo.";
  }

  const engine: Engine = isEngine(raw.engine) ? raw.engine : "postgres";

  const host = asString(raw.host);
  if (!host) errors.host = "Host is required.";
  else if (host.length > 253) errors.host = "Host is too long.";

  const port = asPort(raw.port, engine);
  if (port === null) errors.port = "Port must be an integer between 1 and 65535.";

  const database = asString(raw.database);
  if (engine !== "mongo" && !database) {
    errors.database = "Database name is required for SQL engines.";
  } else if (database.length > 128) {
    errors.database = "Database name is too long.";
  }

  const username = asString(raw.username);
  if (username.length > 128) errors.username = "Username is too long.";

  const password = typeof raw.password === "string" ? raw.password : undefined;
  if (password !== undefined && password.length > 1024) {
    errors.password = "Password is too long.";
  }

  const options = typeof raw.options === "string" ? raw.options : "";
  if (options.length > 4000) errors.options = "Options must be 4000 characters or fewer.";

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      name,
      engine,
      host,
      port: port ?? DEFAULT_PORTS[engine],
      database,
      username,
      password,
      ssl: asBoolean(raw.ssl),
      readOnly: asBoolean(raw.readOnly),
      options,
    },
  };
}

export function parseOptions(raw?: string): Record<string, string> {
  if (!raw?.trim()) return {};
  const text = raw.trim();
  if (text.startsWith("{")) {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Options JSON must be an object.");
    }
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [
        key,
        value === undefined || value === null ? "" : String(value),
      ]),
    );
  }

  const out: Record<string, string> = {};
  for (const part of text.split(/[\n,&]+/)) {
    const line = part.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

export function optionFlag(options: Record<string, string>, key: string): boolean | undefined {
  const value = options[key];
  if (value === undefined) return undefined;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}
