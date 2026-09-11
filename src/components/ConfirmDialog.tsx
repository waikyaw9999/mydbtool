type Props = {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Continue",
  danger,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="dialog" style={{ width: "min(440px, 100%)" }}>
        <div className="dialog-head">
          <strong id="confirm-title">{title}</strong>
          <button className="btn btn-ghost" type="button" onClick={onCancel} aria-label="Close">
            ✕
          </button>
        </div>
        <p style={{ margin: 0, padding: "16px", color: "var(--muted)" }}>{message}</p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "0 16px 16px" }}>
          <button className="btn" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className={`btn ${danger ? "btn-danger-solid" : "btn-primary"}`} type="button" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
