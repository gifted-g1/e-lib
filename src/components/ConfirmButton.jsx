import { useEffect, useState } from 'react';

// Two-step button. Native confirm() dialogs can end up behind the always-on-top kiosk window.
export default function ConfirmButton({ onConfirm, children, confirmLabel = 'Yes, do it', className = 'btn btn-small btn-danger-soft' }) {
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (!asking) return undefined;
    const t = setTimeout(() => setAsking(false), 5000);
    return () => clearTimeout(t);
  }, [asking]);

  if (!asking) {
    return (
      <button type="button" className={className} onClick={() => setAsking(true)}>
        {children}
      </button>
    );
  }
  return (
    <span className="confirm-inline">
      <button
        type="button"
        className="btn btn-small btn-danger"
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </button>
      <button type="button" className="btn btn-small" onClick={() => setAsking(false)}>
        Cancel
      </button>
    </span>
  );
}
