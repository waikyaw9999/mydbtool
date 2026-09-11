"use client";

import { useState } from "react";

type Props = {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  /** When set, the confirm button stays disabled until the typed value matches. */
  typedValue?: string;
  typedLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Continue",
  danger,
  typedValue,
  typedLabel = "Type the name to confirm",
  onConfirm,
  onCancel,
}: Props) {
  const [typed, setTyped] = useState("");
  const canConfirm = !typedValue || typed === typedValue;

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="dialog" style={{ width: "min(440px, 100%)" }}>
        <div className="dialog-head">
          <strong id="confirm-title">{title}</strong>
          <button className="btn btn-ghost" type="button" onClick={onCancel} aria-label="Close">
            ✕
          </button>
        </div>
        <p style={{ margin: 0, padding: "16px 16px 8px", color: "var(--muted)" }}>{message}</p>
        {typedValue ? (
          <div className="field" style={{ padding: "0 16px 12px" }}>
            <label htmlFor="confirm-typed">{typedLabel}</label>
            <input
              id="confirm-typed"
              className="input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        ) : null}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "0 16px 16px" }}>
          <button className="btn" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className={`btn ${danger ? "btn-danger-solid" : "btn-primary"}`}
            type="button"
            disabled={!canConfirm}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
