import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { decryptSecret, encryptSecret } from "./crypto";
import { toPublic, type ConnectionInput, type PublicConnection, type ResolvedConnection, type StoredConnection } from "./types";

type StoreFile = {
  version: 1;
  connections: StoredConnection[];
};

const DATA_DIR = path.join(process.cwd(), "data");
const DEFAULT_FILE = "connections.json";

function storePath(): string {
  return process.env.CONNECTIONS_PATH || path.join(DATA_DIR, DEFAULT_FILE);
}

let writeChain: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function readStore(): Promise<StoreFile> {
  try {
    const raw = await readFile(/* turbopackIgnore: true */ storePath(), "utf8");
    const parsed = JSON.parse(raw) as StoreFile;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.connections)) {
      return { version: 1, connections: [] };
    }
    return parsed;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { version: 1, connections: [] };
    throw err;
  }
}

async function writeStore(store: StoreFile): Promise<void> {
  const file = storePath();
  await mkdir(/* turbopackIgnore: true */ path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(/* turbopackIgnore: true */ tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  await rename(/* turbopackIgnore: true */ tmp, file);
}

export async function listConnections(): Promise<PublicConnection[]> {
  const store = await readStore();
  return store.connections
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(toPublic);
}

export async function getStored(id: string): Promise<StoredConnection | null> {
  const store = await readStore();
  return store.connections.find((item) => item.id === id) ?? null;
}

export async function resolveConnection(id: string): Promise<ResolvedConnection> {
  const stored = await getStored(id);
  if (!stored) throw new Error("Connection not found.");
  return {
    id: stored.id,
    name: stored.name,
    engine: stored.engine,
    host: stored.host,
    port: stored.port,
    database: stored.database,
    username: stored.username,
    password: decryptSecret(stored.passwordEnc),
    ssl: stored.ssl,
    readOnly: stored.readOnly,
    options: stored.options,
  };
}

export async function createConnection(input: ConnectionInput): Promise<PublicConnection> {
  return enqueue(async () => {
    const store = await readStore();
    const now = new Date().toISOString();
    const stored: StoredConnection = {
      id: randomUUID(),
      name: input.name,
      engine: input.engine,
      host: input.host,
      port: input.port,
      database: input.database,
      username: input.username,
      passwordEnc: encryptSecret(input.password ?? ""),
      ssl: input.ssl,
      readOnly: input.readOnly,
      options: input.options,
      createdAt: now,
      updatedAt: now,
    };
    store.connections.push(stored);
    await writeStore(store);
    return toPublic(stored);
  });
}

export async function updateConnection(
  id: string,
  input: ConnectionInput,
): Promise<PublicConnection> {
  return enqueue(async () => {
    const store = await readStore();
    const index = store.connections.findIndex((item) => item.id === id);
    if (index === -1) throw new Error("Connection not found.");
    const prev = store.connections[index];
    if (!prev) throw new Error("Connection not found.");
    const keepPassword = input.password === undefined || input.password === "";
    const next: StoredConnection = {
      ...prev,
      name: input.name,
      engine: input.engine,
      host: input.host,
      port: input.port,
      database: input.database,
      username: input.username,
      passwordEnc: keepPassword ? prev.passwordEnc : encryptSecret(input.password ?? ""),
      ssl: input.ssl,
      readOnly: input.readOnly,
      options: input.options,
      updatedAt: new Date().toISOString(),
    };
    store.connections[index] = next;
    await writeStore(store);
    return toPublic(next);
  });
}

export async function deleteConnection(id: string): Promise<void> {
  await enqueue(async () => {
    const store = await readStore();
    const next = store.connections.filter((item) => item.id !== id);
    if (next.length === store.connections.length) {
      throw new Error("Connection not found.");
    }
    store.connections = next;
    await writeStore(store);
  });
}

export function resolvedFromInput(input: ConnectionInput): ResolvedConnection {
  return {
    name: input.name,
    engine: input.engine,
    host: input.host,
    port: input.port,
    database: input.database,
    username: input.username,
    password: input.password ?? "",
    ssl: input.ssl,
    readOnly: input.readOnly,
    options: input.options,
  };
}
