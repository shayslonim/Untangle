import { useEffect, useRef, useState } from "react";
import { api } from "../api";

type Format = "json" | "csv";

// Pretty-print JSON exports for a readable preview; CSV is shown verbatim.
function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// The two data buttons on Trends plus the modal that backs them. `onImported`
// asks the app to refresh entries/stats; `flash` shows a toast.
export function DataTools({
  onImported,
  flash,
}: {
  onImported: () => void;
  flash: (msg: string) => void;
}) {
  const [mode, setMode] = useState<"export" | "import" | null>(null);

  return (
    <>
      <div className="export-row">
        <button className="btn ghost" onClick={() => setMode("export")}>
          Export
        </button>
        <button className="btn ghost" onClick={() => setMode("import")}>
          Import
        </button>
      </div>

      {mode === "export" && <ExportModal onClose={() => setMode(null)} />}
      {mode === "import" && (
        <ImportModal
          onClose={() => setMode(null)}
          onImported={onImported}
          flash={flash}
        />
      )}
    </>
  );
}

function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
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
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 className="modal-title">{title}</h2>
          <button className="modal-x" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-foot">{footer}</div>
      </div>
    </div>
  );
}

function ExportModal({ onClose }: { onClose: () => void }) {
  const [format, setFormat] = useState<Format>("json");
  const [text, setText] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .exportText(format)
      .then((raw) => {
        if (!alive) return;
        setText(format === "json" ? prettyJson(raw) : raw);
      })
      .catch(() => alive && setText("Couldn't load export."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [format]);

  const stamp = new Date().toISOString().slice(0, 10);
  const doDownload = () =>
    download(
      `untangle-${stamp}.${format}`,
      text,
      format === "json" ? "application/json" : "text/csv"
    );

  return (
    <Modal
      title="Export data"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn solid" onClick={doDownload} disabled={loading}>
            Download {format.toUpperCase()}
          </button>
        </>
      }
    >
      <div className="seg" role="tablist">
        {(["json", "csv"] as Format[]).map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={format === f}
            className={format === f ? "on" : ""}
            onClick={() => setFormat(f)}
          >
            {f.toUpperCase()}
          </button>
        ))}
      </div>
      <p className="modal-hint">A copy of all your entries. Your data, on your device.</p>
      <pre className="data-preview" aria-live="polite">
        {loading ? "Loading…" : text}
      </pre>
    </Modal>
  );
}

function ImportModal({
  onClose,
  onImported,
  flash,
}: {
  onClose: () => void;
  onImported: () => void;
  flash: (msg: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [entries, setEntries] = useState<unknown[] | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [replace, setReplace] = useState(false);
  const [fileName, setFileName] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File) => {
    setError(null);
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      // Accept a full export ({ entries: [...] }) or a bare array.
      const list = Array.isArray(parsed) ? parsed : parsed?.entries;
      if (!Array.isArray(list)) throw new Error("no entries array");
      setEntries(list);
      setFileName(file.name);
      setPreview(prettyJson(JSON.stringify(list)));
    } catch {
      setEntries(null);
      setPreview("");
      setError("That doesn't look like an Untangle JSON export.");
    }
  };

  const doImport = async () => {
    if (!entries) return;
    setBusy(true);
    try {
      const { imported } = await api.importEntries(entries, replace);
      onImported();
      flash(`Imported ${imported} ${imported === 1 ? "entry" : "entries"}`);
      onClose();
    } catch {
      setError("Import failed. Please try again.");
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Import data"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn solid"
            onClick={doImport}
            disabled={!entries || busy}
          >
            Import{entries ? ` ${entries.length}` : ""}
          </button>
        </>
      }
    >
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
      <div className="export-row">
        <button className="btn ghost" onClick={() => fileRef.current?.click()}>
          {fileName ? `Chosen: ${fileName}` : "Choose a .json file…"}
        </button>
      </div>

      <label className="modal-check">
        <input
          type="checkbox"
          checked={replace}
          onChange={(e) => setReplace(e.target.checked)}
        />
        Replace existing entries (otherwise add to them)
      </label>

      {error && <p className="modal-error">{error}</p>}

      <p className="modal-hint">
        {entries
          ? `${entries.length} ${entries.length === 1 ? "entry" : "entries"} ready to import.`
          : "Restore a backup or move from another device."}
      </p>
      {preview && (
        <pre className="data-preview" aria-live="polite">
          {preview}
        </pre>
      )}
    </Modal>
  );
}
