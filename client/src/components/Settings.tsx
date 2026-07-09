import { useEffect } from "react";

// Settings dialog. Preferences here are display-only and live on-device — they
// never change what's stored or exported (the DB and exports always keep full
// second-precision timestamps).
export function Settings({
  onClose,
  showSeconds,
  onToggleSeconds,
  rememberDevice,
  onToggleRemember,
}: {
  onClose: () => void;
  showSeconds: boolean;
  onToggleSeconds: (next: boolean) => void;
  rememberDevice: boolean;
  onToggleRemember: (next: boolean) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 className="modal-title">Settings</h2>
          <button className="modal-x" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <label className="setting-row">
            <span>
              <span className="setting-label">Show seconds</span>
              <span className="setting-hint">
                Display log times to the second. Seconds are always recorded and
                exported either way.
              </span>
            </span>
            <input
              type="checkbox"
              className="switch"
              checked={showSeconds}
              onChange={(e) => onToggleSeconds(e.target.checked)}
            />
          </label>

          <label className="setting-row">
            <span>
              <span className="setting-label">Remember data on this device</span>
              <span className="setting-hint">
                Keeps your log on this device so it loads instantly, even before
                the server wakes up. Turn off on shared or public computers.
              </span>
            </span>
            <input
              type="checkbox"
              className="switch"
              checked={rememberDevice}
              onChange={(e) => onToggleRemember(e.target.checked)}
            />
          </label>
        </div>
        <div className="modal-foot">
          <button className="btn solid" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
