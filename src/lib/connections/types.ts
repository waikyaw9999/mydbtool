export const ENGINES = ["postgres", "mysql", "mssql", "mongo"] as const;

export type Engine = (typeof ENGINES)[number];

export const DEFAULT_PORTS: Record<Engine, number> = {
  postgres: 5432,
  mysql: 3306,
  mssql: 1433,
  mongo: 27017,
};

export const ENGINE_LABELS: Record<Engine, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  mssql: "SQL Server",
  mongo: "MongoDB",
};

export type ConnectionInput = {
  name: string;
  engine: Engine;
  host: string;
  port: number;
  database: string;
  username: string;
  password?: string;
  ssl: boolean;
  readOnly: boolean;
  options: string;
};

export type StoredConnection = {
  id: string;
  name: string;
  engine: Engine;
  host: string;
  port: number;
  database: string;
  username: string;
  passwordEnc: string;
  ssl: boolean;
  readOnly: boolean;
  options: string;
  createdAt: string;
  updatedAt: string;
};

export type PublicConnection = {
  id: string;
  name: string;
  engine: Engine;
  host: string;
  port: number;
  database: string;
  username: string;
  hasPassword: boolean;
  ssl: boolean;
  readOnly: boolean;
  options: string;
  createdAt: string;
  updatedAt: string;
};

export type ResolvedConnection = {
  id?: string;
  name: string;
  engine: Engine;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
  readOnly: boolean;
  options: string;
};

export function toPublic(conn: StoredConnection): PublicConnection {
  return {
    id: conn.id,
    name: conn.name,
    engine: conn.engine,
    host: conn.host,
    port: conn.port,
    database: conn.database,
    username: conn.username,
    hasPassword: Boolean(conn.passwordEnc),
    ssl: conn.ssl,
    readOnly: conn.readOnly,
    options: conn.options,
    createdAt: conn.createdAt,
    updatedAt: conn.updatedAt,
  };
}
