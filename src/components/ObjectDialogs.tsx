"use client";

import { useState, type FormEvent, type ReactNode } from "react";

import type { Engine } from "@/lib/connections/types";
import {
  SQL_COLUMN_TYPES,
  SQL_TYPE_LABELS,
  defaultSchemaFor,
  type ColumnInput,
  type ManageRequest,
  type SqlColumnType,
} from "@/lib/db/ddl";

export type ManageDialogState =
  | { type: "createTable"; database?: string; schema?: string }
  | { type: "createCollection"; database?: string }
  | { type: "renameTable"; database?: string; schema?: string; table: string }
  | { type: "renameCollection"; database?: string; collection: string }
  | { type: "addColumn"; database?: string; schema?: string; table: string }
  | { type: "dropColumn"; database?: string; schema?: string; table: string };

type Props = {
  engine: Engine;
  state: ManageDialogState;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (body: ManageRequest) => void;
};

function emptyColumn(): ColumnInput {
  return { name: "", type: "text", nullable: true, primaryKey: false };
}

export function ObjectManageDialog({ engine, state, busy, error, onClose, onSubmit }: Props) {
  if (state.type === "createTable") {
    return (
      <CreateTableForm
        engine={engine}
        database={state.database}
        schema={state.schema}
        busy={busy}
        error={error}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    );
  }
  if (state.type === "createCollection") {
    return (
      <CollectionForm
        title="New collection"
        database={state.database}
        busy={busy}
        error={error}
        onClose={onClose}
        onSubmit={(database, collection) =>
          onSubmit({ action: "createCollection", database, collection })
        }
      />
    );
  }
  if (state.type === "renameTable") {
    return (
      <RenameForm
        title={`Rename table ${state.table}`}
        current={state.table}
        busy={busy}
        error={error}
        onClose={onClose}
        onSubmit={(newName) =>
          onSubmit({
            action: "renameTable",
            database: state.database,
            schema: state.schema,
            table: state.table,
            newName,
          })
        }
      />
    );
  }
  if (state.type === "renameCollection") {
    return (
      <RenameForm
        title={`Rename collection ${state.collection}`}
        current={state.collection}
        busy={busy}
        error={error}
        onClose={onClose}
        onSubmit={(newName) =>
          onSubmit({
            action: "renameCollection",
            database: state.database,
            collection: state.collection,
            newName,
          })
        }
      />
    );
  }
  if (state.type === "addColumn") {
    return (
      <AddColumnForm
        engine={engine}
        table={state.table}
        busy={busy}
        error={error}
        onClose={onClose}
        onSubmit={(column) =>
          onSubmit({
            action: "addColumn",
            database: state.database,
            schema: state.schema,
            table: state.table,
            column,
          })
        }
      />
    );
  }
  return (
    <DropColumnForm
      table={state.table}
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={(columnName) =>
        onSubmit({
          action: "dropColumn",
          database: state.database,
          schema: state.schema,
          table: state.table,
          columnName,
          confirmDestructive: true,
        })
      }
    />
  );
}

function CreateTableForm({
  engine,
  database,
  schema,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  engine: Engine;
  database?: string;
  schema?: string;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (body: ManageRequest) => void;
}) {
  const showSchema = engine !== "mysql";
  const [table, setTable] = useState("");
  const [schemaName, setSchemaName] = useState(schema || defaultSchemaFor(engine) || "");
  const [columns, setColumns] = useState<ColumnInput[]>([
    { name: "id", type: "int", nullable: false, primaryKey: true },
  ]);

  function patchColumn(index: number, patch: Partial<ColumnInput>) {
    setColumns((prev) =>
      prev.map((col, i) => {
        if (i !== index) return col;
        const next = { ...col, ...patch };
        if (next.primaryKey) next.nullable = false;
        return next;
      }),
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit({
      action: "createTable",
      database,
      schema: showSchema ? schemaName : undefined,
      table,
      columns,
    });
  }

  return (
    <DialogShell title="New table" onClose={onClose} onSubmit={submit} busy={busy} error={error} confirmLabel="Create table" wide>
      {database ? <p className="dialog-note">Database: {database}</p> : null}
      <p className="dialog-note">Names must be letters, numbers, and underscores only. The server generates and runs the DDL.</p>
      <div className="form-grid">
        <Field label="Table name">
          <input className="input" value={table} onChange={(e) => setTable(e.target.value)} autoFocus required />
        </Field>
        {showSchema ? (
          <Field label="Schema">
            <input className="input" value={schemaName} onChange={(e) => setSchemaName(e.target.value)} />
          </Field>
        ) : (
          <div />
        )}
      </div>
      <div className="column-editor">
        <div className="column-editor-head">
          <span>Columns</span>
          <button className="btn btn-ghost" type="button" onClick={() => setColumns((prev) => [...prev, emptyColumn()])}>
            Add column
          </button>
        </div>
        {columns.map((col, index) => (
          <div key={index} className="column-row">
            <input
              className="input"
              placeholder="name"
              value={col.name}
              onChange={(e) => patchColumn(index, { name: e.target.value })}
            />
            <select
              className="select"
              value={col.type}
              onChange={(e) => patchColumn(index, { type: e.target.value as SqlColumnType })}
            >
              {SQL_COLUMN_TYPES.map((type) => (
                <option key={type} value={type}>
                  {SQL_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
            <label className="toggle">
              <input
                type="checkbox"
                checked={col.nullable}
                disabled={col.primaryKey}
                onChange={(e) => patchColumn(index, { nullable: e.target.checked })}
              />
              Null
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={col.primaryKey}
                onChange={(e) => patchColumn(index, { primaryKey: e.target.checked })}
              />
              PK
            </label>
            <button
              className="btn btn-ghost"
              type="button"
              aria-label="Remove column"
              disabled={columns.length <= 1}
              onClick={() => setColumns((prev) => prev.filter((_, i) => i !== index))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </DialogShell>
  );
}

function CollectionForm({
  title,
  database,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  title: string;
  database?: string;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (database: string, collection: string) => void;
}) {
  const [db, setDb] = useState(database ?? "");
  const [collection, setCollection] = useState("");
  return (
    <DialogShell
      title={title}
      onClose={onClose}
      busy={busy}
      error={error}
      confirmLabel="Create collection"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(db, collection);
      }}
    >
      <div className="form-grid">
        <Field label="Database">
          <input className="input" value={db} onChange={(e) => setDb(e.target.value)} required />
        </Field>
        <Field label="Collection">
          <input className="input" value={collection} onChange={(e) => setCollection(e.target.value)} autoFocus required />
        </Field>
      </div>
      <p className="dialog-note">Collection names may include letters, numbers, underscores, dots, and hyphens.</p>
    </DialogShell>
  );
}

function RenameForm({
  title,
  current,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  title: string;
  current: string;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (newName: string) => void;
}) {
  const [name, setName] = useState(current);
  return (
    <DialogShell
      title={title}
      onClose={onClose}
      busy={busy}
      error={error}
      confirmLabel="Rename"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(name);
      }}
    >
      <Field label="New name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
      </Field>
    </DialogShell>
  );
}

function AddColumnForm({
  engine,
  table,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  engine: Engine;
  table: string;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (column: ColumnInput) => void;
}) {
  const [column, setColumn] = useState<ColumnInput>(emptyColumn());
  return (
    <DialogShell
      title={`Add column to ${table}`}
      onClose={onClose}
      busy={busy}
      error={error}
      confirmLabel="Add column"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(column);
      }}
    >
      <div className="form-grid">
        <Field label="Name">
          <input className="input" value={column.name} onChange={(e) => setColumn({ ...column, name: e.target.value })} autoFocus required />
        </Field>
        <Field label="Type">
          <select
            className="select"
            value={column.type}
            onChange={(e) => setColumn({ ...column, type: e.target.value as SqlColumnType })}
          >
            {SQL_COLUMN_TYPES.map((type) => (
              <option key={type} value={type}>
                {SQL_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nullable">
          <label className="toggle">
            <input
              type="checkbox"
              checked={column.nullable}
              onChange={(e) => setColumn({ ...column, nullable: e.target.checked })}
            />
            Allow NULL
          </label>
        </Field>
      </div>
      {engine === "mssql" && !column.nullable ? (
        <p className="dialog-note">SQL Server may require a default when adding a NOT NULL column to a table with rows.</p>
      ) : null}
    </DialogShell>
  );
}

function DropColumnForm({
  table,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  table: string;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (columnName: string) => void;
}) {
  const [name, setName] = useState("");
  return (
    <DialogShell
      title={`Drop column from ${table}`}
      onClose={onClose}
      busy={busy}
      error={error}
      confirmLabel="Drop column"
      danger
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(name);
      }}
    >
      <Field label="Column name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
      </Field>
      <p className="dialog-note">This removes the column and its data. It cannot be undone.</p>
    </DialogShell>
  );
}

function DialogShell({
  title,
  children,
  busy,
  error,
  confirmLabel,
  danger,
  wide,
  onClose,
  onSubmit,
}: {
  title: string;
  children: ReactNode;
  busy?: boolean;
  error?: string | null;
  confirmLabel: string;
  danger?: boolean;
  wide?: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="obj-title">
      <form className={`dialog ${wide ? "wide" : ""}`} onSubmit={onSubmit}>
        <div className="dialog-head">
          <strong id="obj-title">{title}</strong>
          <button className="btn btn-ghost" type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {error ? <div className="banner err">{error}</div> : null}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "0 16px 16px" }}>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className={`btn ${danger ? "btn-danger-solid" : "btn-primary"}`} type="submit" disabled={busy}>
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}
