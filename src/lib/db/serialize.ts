function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function serializeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  if (typeof value === "function") return undefined;
  if (value instanceof Date) return value.toISOString();
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    return `\\x${value.toString("hex")}`;
  }
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    const buf = Buffer.from(view.buffer, view.byteOffset, view.byteLength);
    return `\\x${buf.toString("hex")}`;
  }
  if (typeof value === "object") {
    const rec = value as { _bsontype?: string; toJSON?: () => unknown; toString?: () => string };
    if (rec._bsontype) {
      if (typeof rec.toJSON === "function") return rec.toJSON();
      return String(value);
    }
    if (typeof rec.toJSON === "function") {
      try {
        return serializeValue(rec.toJSON());
      } catch {
        // fall through
      }
    }
    if (Array.isArray(value)) return value.map((item) => serializeValue(item));
    if (isPlainObject(value)) {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        out[key] = serializeValue(item);
      }
      return out;
    }
    return String(value);
  }
  return value;
}

export function rowsFromRecords(
  records: Array<Record<string, unknown>>,
  extraColumns: string[] = [],
): { columns: string[]; rows: Array<Record<string, unknown>> } {
  const columns: string[] = [...extraColumns];
  const rows = records.map((record) => {
    const row: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      if (!columns.includes(key)) columns.push(key);
      row[key] = serializeValue(value);
    }
    return row;
  });
  return { columns, rows };
}

export function sanitizeError(err: unknown): string {
  let message = err instanceof Error ? err.message : String(err);
  message = message.replace(/(password|pwd|passwd)\s*[=:]\s*([^\s;&]+)/gi, "$1=***");
  message = message.replace(/\/\/([^:/\s]+):([^@/\s]+)@/g, "//$1:***@");
  message = message.replace(/mongodb(\+srv)?:\/\/[^/\s]+/gi, "mongodb://***");
  return message;
}
