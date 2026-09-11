import { useState } from "react";

import type { QueryResult } from "@/lib/db/types";

type Props = {
  result: QueryResult;
  view?: "table" | "json";
  onViewChange?: (view: "table" | "json") => void;
  onLoadMore?: () => void;
  loadingMore?: boolean;
};

function cellText(value: unknown): string {
  if (value === null) return "NULL";
  if (value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function ResultGrid({ result, view = "table", onViewChange, onLoadMore, loadingMore }: Props) {
  const [openCell, setOpenCell] = useState<string | null>(null);

  return (
    <div className="result-pane">
      <div className="editor-toolbar">
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="chip chip-ok">{result.command || "result"}</span>
          <span style={{ color: "var(--muted)" }}>
            {result.rows.length} row{result.rows.length === 1 ? "" : "s"}
            {result.truncated ? " (truncated)" : ""}
            {typeof result.affectedRows === "number" ? ` · ${result.affectedRows} affected` : ""}
            {` · ${result.durationMs} ms`}
          </span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {onViewChange ? (
            <>
              <button
                className={`btn ${view === "table" ? "btn-primary" : ""}`}
                type="button"
                onClick={() => onViewChange("table")}
              >
                Table
              </button>
              <button
                className={`btn ${view === "json" ? "btn-primary" : ""}`}
                type="button"
                onClick={() => onViewChange("json")}
              >
                JSON
              </button>
            </>
          ) : null}
          {result.truncated && onLoadMore ? (
            <button className="btn" type="button" onClick={onLoadMore} disabled={loadingMore}>
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          ) : null}
        </div>
      </div>
      {result.columnsMeta?.length ? (
        <div className="meta-list">
          {result.columnsMeta.map((col) => (
            <span key={col.name} className="chip" title={col.defaultValue ?? undefined}>
              {col.name}
              <span style={{ color: "var(--faint)", fontWeight: 500 }}>{col.type}</span>
            </span>
          ))}
        </div>
      ) : null}
      {result.rows.length === 0 ? (
        <div className="empty">
          <p>{typeof result.affectedRows === "number" ? "Statement completed." : "Query returned 0 rows."}</p>
        </div>
      ) : view === "json" ? (
        <pre className="json-view">{JSON.stringify(result.rows, null, 2)}</pre>
      ) : (
        <div className="grid-wrap">
          <table className="data-grid">
            <thead>
              <tr>
                <th style={{ width: 44 }}>#</th>
                {result.columns.map((col) => (
                  <th key={col}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, index) => (
                <tr key={index}>
                  <td style={{ color: "var(--faint)" }}>{index + 1}</td>
                  {result.columns.map((col) => {
                    const key = `${index}:${col}`;
                    const text = cellText(row[col]);
                    return (
                      <td
                        key={col}
                        title={text}
                        onClick={() => setOpenCell(openCell === key ? null : key)}
                        style={{ color: row[col] === null ? "var(--faint)" : undefined, fontStyle: row[col] === null ? "italic" : undefined }}
                      >
                        {openCell === key && text.length > 48 ? text : text}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
