"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";

import { api, ApiError } from "@/lib/client/api";
import {
  DEFAULT_PORTS,
  ENGINE_LABELS,
  ENGINES,
  type Engine,
  type PublicConnection,
} from "@/lib/connections/types";
import { validateConnectionInput } from "@/lib/connections/validation";
import type { TestResult } from "@/lib/db/types";

type FormState = {
  name: string;
  engine: Engine;
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
  readOnly: boolean;
  options: string;
};

const emptyForm = (engine: Engine = "postgres"): FormState => ({
  name: "",
  engine,
  host: "localhost",
  port: String(DEFAULT_PORTS[engine]),
  database: "",
  username: "",
  password: "",
  ssl: false,
  readOnly: false,
  options: "",
});

function fromConnection(conn: PublicConnection): FormState {
  return {
    name: conn.name,
    engine: conn.engine,
    host: conn.host,
    port: String(conn.port),
    database: conn.database,
    username: conn.username,
    password: "",
    ssl: conn.ssl,
    readOnly: conn.readOnly,
    options: conn.options,
  };
}

type Props = {
  editing?: PublicConnection | null;
  onClose: () => void;
  onSaved: (conn: PublicConnection) => void;
};

export function ConnectionDialog({ editing, onClose, onSaved }: Props) {
  const [form, setForm] = useState<FormState>(() =>
    editing ? fromConnection(editing) : emptyForm(),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [test, setTest] = useState<TestResult | { ok: false; message: string } | null>(null);

  const title = editing ? "Edit connection" : "New connection";
  const optionsHint = useMemo(() => {
    if (form.engine === "mongo") return "authSource=admin\nreplicaSet=rs0";
    if (form.engine === "mssql") return "encrypt=true\ntrustServerCertificate=true";
    return "rejectUnauthorized=false";
  }, [form.engine]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "engine") {
        const engine = value as Engine;
        const oldDefault = String(DEFAULT_PORTS[prev.engine]);
        if (!prev.port || prev.port === oldDefault) {
          next.port = String(DEFAULT_PORTS[engine]);
        }
      }
      return next;
    });
    setErrors((prev) => {
      if (!prev[key as string]) return prev;
      const next = { ...prev };
      delete next[key as string];
      return next;
    });
  }

  function payload() {
    return {
      name: form.name,
      engine: form.engine,
      host: form.host,
      port: Number(form.port),
      database: form.database,
      username: form.username,
      password: form.password,
      ssl: form.ssl,
      readOnly: form.readOnly,
      options: form.options,
    };
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = validateConnectionInput(payload());
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setBusy("save");
    setTest(null);
    try {
      const res = editing
        ? await api<{ connection: PublicConnection }>(`/api/connections/${editing.id}`, {
            method: "PUT",
            body: JSON.stringify(parsed.value),
          })
        : await api<{ connection: PublicConnection }>("/api/connections", {
            method: "POST",
            body: JSON.stringify(parsed.value),
          });
      onSaved(res.connection);
    } catch (err) {
      const apiErr = err as ApiError;
      setErrors(apiErr.errors ?? {});
      setTest({ ok: false, message: apiErr.message });
    } finally {
      setBusy(null);
    }
  }

  async function onTest() {
    const parsed = validateConnectionInput(payload());
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setBusy("test");
    setTest(null);
    try {
      const body =
        editing && !form.password
          ? { id: editing.id, ...parsed.value, password: "" }
          : parsed.value;
      const result = await api<TestResult>("/api/connections/test", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setTest(result);
    } catch (err) {
      setTest({ ok: false, message: err instanceof Error ? err.message : "Test failed." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="conn-title">
      <form className="dialog" onSubmit={onSubmit}>
        <div className="dialog-head">
          <div>
            <strong id="conn-title">{title}</strong>
            <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>
              Credentials stay on the server. Passwords are encrypted at rest.
            </div>
          </div>
          <button className="btn btn-ghost" type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="form-grid">
          <Field label="Name" error={errors.name} className="span-2">
            <input
              className="input"
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="Local Postgres"
              autoFocus
            />
          </Field>
          <Field label="Engine" error={errors.engine}>
            <select
              className="select"
              value={form.engine}
              onChange={(e) => update("engine", e.target.value as Engine)}
            >
              {ENGINES.map((engine) => (
                <option key={engine} value={engine}>
                  {ENGINE_LABELS[engine]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Read-only">
            <label className="toggle">
              <input
                type="checkbox"
                checked={form.readOnly}
                onChange={(e) => update("readOnly", e.target.checked)}
              />
              Block writes
            </label>
          </Field>
          <Field label="Host" error={errors.host}>
            <input
              className="input"
              value={form.host}
              onChange={(e) => update("host", e.target.value)}
              placeholder="localhost"
            />
          </Field>
          <Field label="Port" error={errors.port}>
            <input
              className="input"
              value={form.port}
              onChange={(e) => update("port", e.target.value)}
              inputMode="numeric"
            />
          </Field>
          <Field
            label={form.engine === "mongo" ? "Database (optional)" : "Database"}
            error={errors.database}
          >
            <input
              className="input"
              value={form.database}
              onChange={(e) => update("database", e.target.value)}
              placeholder={form.engine === "mongo" ? "admin" : "postgres"}
            />
          </Field>
          <Field label="Username" error={errors.username}>
            <input
              className="input"
              value={form.username}
              onChange={(e) => update("username", e.target.value)}
              autoComplete="off"
            />
          </Field>
          <Field
            label={editing ? "Password (blank keeps current)" : "Password"}
            error={errors.password}
            className="span-2"
          >
            <input
              className="input"
              type="password"
              value={form.password}
              onChange={(e) => update("password", e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <Field label="SSL / TLS">
            <label className="toggle">
              <input
                type="checkbox"
                checked={form.ssl}
                onChange={(e) => update("ssl", e.target.checked)}
              />
              Use encrypted transport
            </label>
          </Field>
          <Field label="Connection options" error={errors.options} className="span-2">
            <textarea
              className="input"
              rows={3}
              value={form.options}
              onChange={(e) => update("options", e.target.value)}
              placeholder={optionsHint}
              style={{ fontFamily: "var(--font-geist-mono), monospace" }}
            />
          </Field>
        </div>
        {test ? (
          <div className={`banner ${test.ok ? "ok" : "err"}`}>
            {test.ok
              ? `${test.message}${test.latencyMs ? ` (${test.latencyMs} ms)` : ""}`
              : test.message}
          </div>
        ) : null}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "0 16px 16px" }}>
          <button className="btn" type="button" onClick={onTest} disabled={busy !== null}>
            {busy === "test" ? "Testing…" : "Test connection"}
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" type="submit" disabled={busy !== null}>
              {busy === "save" ? "Saving…" : editing ? "Save changes" : "Save connection"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  error,
  className,
  children,
}: {
  label: string;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`field ${className ?? ""}`}>
      <label>{label}</label>
      {children}
      {error ? <div className="field-error">{error}</div> : null}
    </div>
  );
}
