"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ConnectionDialog } from "@/components/ConnectionDialog";
import { ObjectTree } from "@/components/ObjectTree";
import { ResultGrid } from "@/components/ResultGrid";
import { api } from "@/lib/client/api";
import { ENGINE_LABELS, type PublicConnection } from "@/lib/connections/types";
import { DEFAULT_RESULT_LIMIT } from "@/lib/db/query-safety";
import { listSqlDatabases } from "@/lib/db/sql-database";
import type { PreviewTarget, QueryResult, QueryResponse, SchemaNode } from "@/lib/db/types";

type SqlTab = {
  id: string;
  kind: "sql";
  title: string;
  connectionId: string;
  database: string;
  sql: string;
  result: QueryResult | null;
  error: string | null;
  running: boolean;
  pendingDestructive?: { reason: string; keywords: string[] };
};

type MongoTab = {
  id: string;
  kind: "mongo";
  title: string;
  connectionId: string;
  database: string;
  collection: string;
  mode: "find" | "aggregate";
  filter: string;
  pipeline: string;
  result: QueryResult | null;
  error: string | null;
  running: boolean;
  offset: number;
  view: "table" | "json";
};

type PreviewTab = {
  id: string;
  kind: "preview";
  title: string;
  connectionId: string;
  target: PreviewTarget;
  result: QueryResult | null;
  error: string | null;
  running: boolean;
  offset: number;
  limit: number;
  view: "table" | "json";
};

type Tab = SqlTab | MongoTab | PreviewTab;

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function Workspace() {
  const [connections, setConnections] = useState<PublicConnection[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tree, setTree] = useState<SchemaNode[] | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"create" | "edit" | null>(null);
  const [confirm, setConfirm] = useState<null | {
    title: string;
    message: string;
    danger?: boolean;
    confirmLabel?: string;
    action: () => void;
  }>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sqlDatabaseByConn, setSqlDatabaseByConn] = useState<Record<string, string>>({});

  const selected = connections.find((item) => item.id === selectedId) ?? null;
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const selectedSqlDatabase = selected
    ? sqlDatabaseByConn[selected.id] || selected.database
    : "";

  function setConnectionSqlDatabase(connectionId: string, database: string) {
    const next = database.trim();
    if (!next) return;
    setSqlDatabaseByConn((prev) =>
      prev[connectionId] === next ? prev : { ...prev, [connectionId]: next },
    );
    setTabs((prev) =>
      prev.map((tab) =>
        tab.kind === "sql" && tab.connectionId === connectionId && tab.database !== next
          ? { ...tab, database: next }
          : tab,
      ),
    );
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/connections")
      .then((res) => res.json())
      .then((data: { connections?: PublicConnection[]; error?: string }) => {
        if (cancelled) return;
        if (data.error) {
          setLoadError(data.error);
          return;
        }
        setConnections(data.connections ?? []);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Failed to load connections.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadTree = useCallback(async (connectionId: string, database?: string) => {
    setTreeLoading(true);
    setTreeError(null);
    try {
      const qs = database ? `?database=${encodeURIComponent(database)}` : "";
      const res = await api<{ objects: SchemaNode[] }>(`/api/connections/${connectionId}/objects${qs}`);
      if (database) {
        setTree((prev) => mergeDatabase(prev ?? [], res.objects, database));
      } else {
        setTree(res.objects);
      }
    } catch (err) {
      setTreeError(err instanceof Error ? err.message : "Failed to load objects.");
    } finally {
      setTreeLoading(false);
    }
  }, []);

  async function selectConnection(conn: PublicConnection) {
    setSelectedId(conn.id);
    setTree(null);
    setSqlDatabaseByConn((prev) =>
      prev[conn.id] || !conn.database ? prev : { ...prev, [conn.id]: conn.database },
    );
    await loadTree(conn.id);
  }

  function patchTab(id: string, patch: Partial<Tab>) {
    setTabs((prev) => prev.map((tab) => (tab.id === id ? ({ ...tab, ...patch } as Tab) : tab)));
  }

  function openSqlTab(conn: PublicConnection, sql = "SELECT 1;") {
    const database = sqlDatabaseByConn[conn.id] || conn.database;
    const tab: SqlTab = {
      id: uid(),
      kind: "sql",
      title: `SQL · ${conn.name}`,
      connectionId: conn.id,
      database,
      sql,
      result: null,
      error: null,
      running: false,
    };
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }

  function openMongoTab(conn: PublicConnection, database = conn.database, collection = "") {
    const tab: MongoTab = {
      id: uid(),
      kind: "mongo",
      title: collection ? `${collection}` : `Find · ${conn.name}`,
      connectionId: conn.id,
      database,
      collection,
      mode: "find",
      filter: "{\n  \n}",
      pipeline: "[\n  { \"$limit\": 100 }\n]",
      result: null,
      error: null,
      running: false,
      offset: 0,
      view: "table",
    };
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }

  async function openPreview(conn: PublicConnection, target: PreviewTarget, title: string) {
    const existing = tabs.find(
      (tab) =>
        tab.kind === "preview" &&
        tab.connectionId === conn.id &&
        tab.target.database === target.database &&
        tab.target.schema === target.schema &&
        tab.target.table === target.table &&
        tab.target.collection === target.collection,
    );
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }
    const tab: PreviewTab = {
      id: uid(),
      kind: "preview",
      title,
      connectionId: conn.id,
      target,
      result: null,
      error: null,
      running: true,
      offset: 0,
      limit: DEFAULT_RESULT_LIMIT,
      view: conn.engine === "mongo" ? "json" : "table",
    };
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
    try {
      const res = await api<{ result: QueryResult }>(`/api/connections/${conn.id}/preview`, {
        method: "POST",
        body: JSON.stringify({ ...target, limit: tab.limit, offset: 0 }),
      });
      patchTab(tab.id, { result: res.result, running: false });
    } catch (err) {
      patchTab(tab.id, {
        running: false,
        error: err instanceof Error ? err.message : "Preview failed.",
      });
    }
  }

  async function runSql(tab: SqlTab, confirmDestructive = false) {
    patchTab(tab.id, { running: true, error: null, pendingDestructive: undefined });
    try {
      const res = await api<{ result: QueryResponse }>(`/api/connections/${tab.connectionId}/query`, {
        method: "POST",
        body: JSON.stringify({
          sql: tab.sql,
          database: tab.database || undefined,
          limit: DEFAULT_RESULT_LIMIT,
          confirmDestructive,
        }),
      });
      if ("needsConfirmation" in res.result && res.result.needsConfirmation) {
        patchTab(tab.id, { running: false, pendingDestructive: res.result });
        setConfirm({
          title: "Destructive statement",
          message: res.result.reason,
          danger: true,
          confirmLabel: "Run anyway",
          action: () => {
            setConfirm(null);
            void runSql({ ...tab, sql: tab.sql }, true);
          },
        });
        return;
      }
      patchTab(tab.id, { running: false, result: res.result as QueryResult });
    } catch (err) {
      patchTab(tab.id, {
        running: false,
        error: err instanceof Error ? err.message : "Query failed.",
      });
    }
  }

  async function runMongo(tab: MongoTab, offset = 0, append = false) {
    patchTab(tab.id, { running: true, error: null });
    try {
      const res = await api<{ result: QueryResult }>(`/api/connections/${tab.connectionId}/query`, {
        method: "POST",
        body: JSON.stringify({
          mongo: {
            database: tab.database,
            collection: tab.collection,
            mode: tab.mode,
            filter: tab.filter,
            pipeline: tab.pipeline,
          },
          limit: DEFAULT_RESULT_LIMIT,
          offset,
        }),
      });
      const nextResult =
        append && tab.result
          ? {
              ...res.result,
              rows: [...tab.result.rows, ...res.result.rows],
              rowCount: tab.result.rows.length + res.result.rows.length,
            }
          : res.result;
      patchTab(tab.id, { running: false, result: nextResult, offset });
    } catch (err) {
      patchTab(tab.id, {
        running: false,
        error: err instanceof Error ? err.message : "Query failed.",
      });
    }
  }

  async function loadMorePreview(tab: PreviewTab) {
    const nextOffset = tab.offset + tab.limit;
    patchTab(tab.id, { running: true });
    try {
      const res = await api<{ result: QueryResult }>(`/api/connections/${tab.connectionId}/preview`, {
        method: "POST",
        body: JSON.stringify({ ...tab.target, limit: tab.limit, offset: nextOffset }),
      });
      const merged = tab.result
        ? {
            ...res.result,
            rows: [...tab.result.rows, ...res.result.rows],
            rowCount: tab.result.rows.length + res.result.rows.length,
            columnsMeta: tab.result.columnsMeta ?? res.result.columnsMeta,
          }
        : res.result;
      patchTab(tab.id, { running: false, result: merged, offset: nextOffset });
    } catch (err) {
      patchTab(tab.id, {
        running: false,
        error: err instanceof Error ? err.message : "Failed to load more.",
      });
    }
  }

  function closeTab(id: string) {
    setTabs((prev) => {
      const next = prev.filter((tab) => tab.id !== id);
      if (activeTabId === id) setActiveTabId(next.at(-1)?.id ?? null);
      return next;
    });
  }

  async function removeConnection(conn: PublicConnection) {
    setConfirm({
      title: "Delete connection",
      message: `Remove “${conn.name}”? Saved credentials for this connection will be deleted.`,
      danger: true,
      confirmLabel: "Delete",
      action: async () => {
        setConfirm(null);
        await api(`/api/connections/${conn.id}`, { method: "DELETE" });
        setConnections((prev) => prev.filter((item) => item.id !== conn.id));
        if (selectedId === conn.id) {
          setSelectedId(null);
          setTree(null);
        }
        setSqlDatabaseByConn((prev) => {
          const next = { ...prev };
          delete next[conn.id];
          return next;
        });
        setTabs((prev) => prev.filter((tab) => tab.connectionId !== conn.id));
      },
    });
  }

  const status = useMemo(() => {
    if (activeTab?.running) return "Running…";
    if (activeTab?.error) return activeTab.error;
    if (activeTab?.result) {
      return `${activeTab.result.rows.length} rows in ${activeTab.result.durationMs} ms`;
    }
    if (selected) {
      const db = sqlDatabaseByConn[selected.id] || selected.database;
      return `${ENGINE_LABELS[selected.engine]} · ${selected.host}:${selected.port}${db ? ` / ${db}` : ""}`;
    }
    return "Ready";
  }, [activeTab, selected, sqlDatabaseByConn]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark">db</div>
          <div>
            <h1>mydbtool</h1>
            <p>Mongo · Postgres · MySQL · SQL Server</p>
          </div>
        </div>
        <button className="btn btn-primary" type="button" onClick={() => setDialog("create")}>
          New connection
        </button>
      </header>

      <aside className="sidebar">
        <div className="sidebar-section">
          <span>Connections</span>
          <span>{connections.length}</span>
        </div>
        <div className="conn-list">
          {connections.length === 0 ? (
            <div style={{ color: "var(--muted)", padding: "8px 6px", fontSize: 12.5 }}>
              No saved connections yet.
            </div>
          ) : (
            connections.map((conn) => (
              <div key={conn.id} className="conn-row">
                <button
                  type="button"
                  className={`conn-item ${selectedId === conn.id ? "active" : ""}`}
                  onClick={() => void selectConnection(conn)}
                >
                  <span className={`chip chip-${conn.engine}`}>{shortEngine(conn.engine)}</span>
                  <div className="conn-meta">
                    <div className="conn-title">
                      {conn.name}
                      {conn.readOnly ? <span className="chip chip-warn">RO</span> : null}
                    </div>
                    <div className="conn-sub">
                      {conn.host}:{conn.port}
                      {conn.database ? ` / ${conn.database}` : ""}
                    </div>
                  </div>
                </button>
                <div className="conn-actions">
                  <button
                    className="btn btn-ghost"
                    type="button"
                    title="Edit connection"
                    onClick={() => {
                      setSelectedId(conn.id);
                      setDialog("edit");
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="btn btn-ghost"
                    type="button"
                    title="Delete connection"
                    onClick={() => void removeConnection(conn)}
                  >
                    Del
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="sidebar-section">
          <span>Objects</span>
          {selected ? (
            <button className="btn btn-ghost" type="button" onClick={() => void loadTree(selected.id)}>
              Refresh
            </button>
          ) : null}
        </div>
        <div className="tree-wrap">
          {!selected ? (
            <div style={{ color: "var(--muted)", padding: 8 }}>Select a connection to browse objects.</div>
          ) : treeLoading && !tree ? (
            <div style={{ color: "var(--muted)", padding: 8 }}>Loading objects…</div>
          ) : treeError ? (
            <div className="banner err" style={{ margin: 0 }}>{treeError}</div>
          ) : tree ? (
            <ObjectTree
              nodes={tree}
              activeDatabase={selectedSqlDatabase}
              onSelectDatabase={(name) => setConnectionSqlDatabase(selected.id, name)}
              onExpandDatabase={(name) => {
                setConnectionSqlDatabase(selected.id, name);
                void loadTree(selected.id, name);
              }}
              onOpen={(path) => {
                if (path.database) setConnectionSqlDatabase(selected.id, path.database);
                if (path.kind === "collection") {
                  void openPreview(
                    selected,
                    { database: path.database, collection: path.collection },
                    path.collection || "collection",
                  );
                  return;
                }
                if (path.kind === "table" || path.kind === "view") {
                  void openPreview(
                    selected,
                    { database: path.database, schema: path.schema, table: path.table },
                    path.table || "table",
                  );
                }
              }}
            />
          ) : (
            <div style={{ color: "var(--muted)", padding: 8 }}>Connect to see databases and tables.</div>
          )}
        </div>
        {selected ? (
          <div style={{ padding: 8, borderTop: "1px solid var(--line)" }}>
            <button
              className="btn"
              type="button"
              style={{ width: "100%" }}
              onClick={() =>
                selected.engine === "mongo" ? openMongoTab(selected) : openSqlTab(selected)
              }
            >
              New {selected.engine === "mongo" ? "find / aggregate" : "SQL"} tab
            </button>
          </div>
        ) : null}
      </aside>

      <main className="main">
        <div className="tabbar">
          {tabs.map((tab) => (
            <div key={tab.id} className={`tab ${tab.id === activeTabId ? "active" : ""}`}>
              <button type="button" className="btn-ghost" style={{ padding: 0 }} onClick={() => setActiveTabId(tab.id)}>
                {tab.title}
              </button>
              <button type="button" className="btn-ghost" aria-label="Close tab" onClick={() => closeTab(tab.id)}>
                ×
              </button>
            </div>
          ))}
          {selected ? (
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() =>
                selected.engine === "mongo" ? openMongoTab(selected) : openSqlTab(selected)
              }
            >
              +
            </button>
          ) : null}
        </div>
        {loadError ? <div className="banner err">{loadError}</div> : null}
        {!activeTab ? (
          <div className="empty">
            <div className="brand-mark" style={{ margin: "0 auto" }}>db</div>
            <h2>{connections.length ? "Open a query or preview" : "Workbench is ready"}</h2>
            <p>
              {connections.length
                ? "Select a connection, browse a table or collection, or start a new SQL / Mongo tab. Ctrl/Cmd+Enter runs the active editor."
                : "Save a MongoDB, PostgreSQL, MySQL, or SQL Server connection, then browse objects or run a query. Ctrl/Cmd+Enter runs the active editor."}
            </p>
            {connections.length === 0 ? (
              <button className="btn btn-primary" type="button" onClick={() => setDialog("create")} style={{ minWidth: 160 }}>
                Add a connection
              </button>
            ) : selected ? (
              <button
                className="btn btn-primary"
                type="button"
                onClick={() =>
                  selected.engine === "mongo" ? openMongoTab(selected) : openSqlTab(selected)
                }
                style={{ minWidth: 160 }}
              >
                New query tab
              </button>
            ) : null}
          </div>
        ) : (
          <EditorPane
            tab={activeTab}
            connection={connections.find((item) => item.id === activeTab.connectionId) ?? null}
            databases={
              activeTab.kind === "sql"
                ? listSqlDatabases({
                    connectionDatabase:
                      connections.find((item) => item.id === activeTab.connectionId)?.database,
                    activeDatabase: activeTab.database,
                    tree: selectedId === activeTab.connectionId ? tree : null,
                  })
                : []
            }
            onChange={patchTab}
            onRunSql={(tab) => void runSql(tab)}
            onSqlDatabaseChange={(tab, database) => setConnectionSqlDatabase(tab.connectionId, database)}
            onRunMongo={(tab) => void runMongo(tab)}
            onLoadMorePreview={(tab) => void loadMorePreview(tab)}
            onLoadMoreMongo={(tab) => void runMongo(tab, tab.offset + DEFAULT_RESULT_LIMIT, true)}
          />
        )}
      </main>

      <footer className="status">
        <span>{status}</span>
        <span>{selected?.readOnly ? "Read-only connection" : "Local encrypted connection store"}</span>
      </footer>

      {dialog ? (
        <ConnectionDialog
          editing={dialog === "edit" ? selected : null}
          onClose={() => setDialog(null)}
          onSaved={(conn) => {
            setDialog(null);
            setConnections((prev) => {
              const others = prev.filter((item) => item.id !== conn.id);
              return [...others, conn].sort((a, b) => a.name.localeCompare(b.name));
            });
            setSelectedId(conn.id);
            setSqlDatabaseByConn((prev) =>
              prev[conn.id] || !conn.database ? prev : { ...prev, [conn.id]: conn.database },
            );
            void loadTree(conn.id);
          }}
        />
      ) : null}

      {confirm ? (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          danger={confirm.danger}
          confirmLabel={confirm.confirmLabel}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void confirm.action()}
        />
      ) : null}
    </div>
  );
}

function EditorPane({
  tab,
  connection,
  databases,
  onChange,
  onRunSql,
  onSqlDatabaseChange,
  onRunMongo,
  onLoadMorePreview,
  onLoadMoreMongo,
}: {
  tab: Tab;
  connection: PublicConnection | null;
  databases: string[];
  onChange: (id: string, patch: Partial<Tab>) => void;
  onRunSql: (tab: SqlTab) => void;
  onSqlDatabaseChange: (tab: SqlTab, database: string) => void;
  onRunMongo: (tab: MongoTab) => void;
  onLoadMorePreview: (tab: PreviewTab) => void;
  onLoadMoreMongo: (tab: MongoTab) => void;
}) {
  const sqlTarget =
    tab.kind === "sql"
      ? `${connection?.host ?? "SQL"}${connection ? `:${connection.port}` : ""} · ${tab.database || connection?.database || "database"}`
      : "";

  return (
    <div className="editor-pane">
      <div className="editor-stack">
        {tab.kind === "sql" ? (
          <>
            <div className="editor-toolbar">
              <div className="editor-db">
                <span className="editor-db-host">
                  {connection ? `${connection.host}:${connection.port}` : "SQL"}
                </span>
                <span aria-hidden="true">·</span>
                {tab.kind === "sql" && databases.length > 1 ? (
                  <select
                    className="select"
                    aria-label="Database"
                    value={tab.database}
                    onChange={(e) => onSqlDatabaseChange(tab, e.target.value)}
                  >
                    {databases.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span title={sqlTarget}>{tab.database || connection?.database || "database"}</span>
                )}
                <span style={{ color: "var(--faint)" }}>Ctrl/Cmd+Enter to run</span>
              </div>
              <button className="btn btn-primary" type="button" disabled={tab.running} onClick={() => onRunSql(tab)}>
                {tab.running ? "Running…" : "Run"}
              </button>
            </div>
            <textarea
              className="code-area"
              value={tab.sql}
              spellCheck={false}
              onChange={(e) => onChange(tab.id, { sql: e.target.value })}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  onRunSql(tab);
                }
              }}
            />
          </>
        ) : null}

        {tab.kind === "mongo" ? (
          <>
            <div className="editor-toolbar">
              <div style={{ display: "flex", gap: 8, flex: 1, minWidth: 0 }}>
                <input
                  className="input"
                  style={{ maxWidth: 160 }}
                  placeholder="database"
                  value={tab.database}
                  onChange={(e) => onChange(tab.id, { database: e.target.value })}
                />
                <input
                  className="input"
                  style={{ maxWidth: 180 }}
                  placeholder="collection"
                  value={tab.collection}
                  onChange={(e) => onChange(tab.id, { collection: e.target.value, title: e.target.value || tab.title })}
                />
                <select
                  className="select"
                  style={{ maxWidth: 140 }}
                  value={tab.mode}
                  onChange={(e) => onChange(tab.id, { mode: e.target.value as MongoTab["mode"] })}
                >
                  <option value="find">find</option>
                  <option value="aggregate">aggregate</option>
                </select>
              </div>
              <button className="btn btn-primary" type="button" disabled={tab.running} onClick={() => onRunMongo(tab)}>
                {tab.running ? "Running…" : "Run"}
              </button>
            </div>
            <textarea
              className="code-area"
              value={tab.mode === "find" ? tab.filter : tab.pipeline}
              spellCheck={false}
              onChange={(e) =>
                onChange(
                  tab.id,
                  tab.mode === "find" ? { filter: e.target.value } : { pipeline: e.target.value },
                )
              }
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  onRunMongo(tab);
                }
              }}
            />
          </>
        ) : null}

        {tab.kind === "preview" ? (
          <div className="editor-toolbar">
            <span style={{ color: "var(--muted)" }}>
              Preview{" "}
              {[tab.target.database, tab.target.schema, tab.target.collection || tab.target.table]
                .filter(Boolean)
                .join(".")}
            </span>
            <span className="chip">first {tab.limit} rows</span>
          </div>
        ) : null}
      </div>

      <div className="result-stack">
        {tab.error ? <div className="banner err">{tab.error}</div> : null}
        {tab.result ? (
          <ResultGrid
            result={tab.result}
            view={tab.kind === "sql" ? "table" : tab.view}
            onViewChange={
              tab.kind === "sql"
                ? undefined
                : (view) => onChange(tab.id, { view })
            }
            loadingMore={tab.running}
            onLoadMore={
              tab.kind === "preview"
                ? () => onLoadMorePreview(tab)
                : tab.kind === "mongo"
                  ? () => onLoadMoreMongo(tab)
                  : undefined
            }
          />
        ) : tab.kind !== "preview" && !tab.error ? (
          <div className="empty">
            <p>Run a statement to see results here.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function shortEngine(engine: PublicConnection["engine"]): string {
  switch (engine) {
    case "postgres":
      return "PG";
    case "mysql":
      return "MY";
    case "mssql":
      return "MS";
    case "mongo":
      return "MG";
  }
}

function mergeDatabase(tree: SchemaNode[], incoming: SchemaNode[], database: string): SchemaNode[] {
  const replacement = incoming.find((node) => node.name === database) ?? incoming[0];
  if (!replacement) return tree;
  let found = false;
  const next = tree.map((node) => {
    if (node.kind === "database" && node.name === database) {
      found = true;
      return replacement;
    }
    return node;
  });
  return found ? next : [...next, replacement];
}
