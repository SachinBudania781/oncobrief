import { useEffect, useState } from "react";
import { X, Download, ScanText } from "lucide-react";
import { api, fmtDate, CATEGORY_COLORS } from "../api";
import { request } from "../care/client";

// Opens the ORIGINAL file next to its OCR text and tags — the brief is never the last word.
export default function DocViewer({ docId, onClose }) {
  const [doc, setDoc] = useState(null);
  const [err, setErr] = useState("");
  const [page, setPage] = useState(0);
  const [focus, setFocus] = useState("");
  const [explanation, setExplanation] = useState(null);
  useEffect(() => {
    if (!docId) return;
    setDoc(null);
    setErr("");
    setPage(0);
    setFocus("");
    setExplanation(null);
    let live = true;
    const load = () =>
      api
        .document(docId)
        .then((d) => {
          if (live) setDoc(d);
        })
        .catch((e) => {
          if (live) setErr(e.message);
        });
    load();
    const timer = setInterval(load, 150000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [docId]);
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!docId) return null;
  const isPdf = doc?.mime === "application/pdf";
  const lowOcr = doc?.ocr_confidence != null && doc.ocr_confidence < 75;
  const token = doc
    ? new URL(doc.file_url, window.location.origin).searchParams.get("token")
    : "";
  const boxes =
    doc?.geometry?.[page]?.words?.filter(
      (w) => focus && w.text.toLowerCase().includes(focus.toLowerCase()),
    ) || [];
  return (
    <>
      <div className="drawer-back" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Original document">
        <div className="drawer-head">
          <span
            className="dot"
            style={{
              background: CATEGORY_COLORS[doc?.category] || "var(--ink-3)",
              marginTop: 8,
            }}
          />
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: 18 }}>
              {doc ? doc.title : "Loading…"}{" "}
              {doc && <span className="src static">{doc.tag}</span>}
            </h2>
            {doc && (
              <div className="row wrap small muted" style={{ marginTop: 4 }}>
                <span>
                  {doc.category} / {doc.subtype}
                </span>
                <span>Report date {fmtDate(doc.record_date)}</span>
                <span>Uploaded by {doc.uploaded_by}</span>
                {doc.external_hospital && (
                  <span className="chip">{doc.external_hospital}</span>
                )}
              </div>
            )}
          </div>
          <div className="spacer" />
          {doc && (
            <a
              className="btn"
              href={doc.file_url}
              target="_blank"
              rel="noreferrer"
            >
              <Download size={16} /> Original
            </a>
          )}
          {doc && (
            <button
              className="btn"
              onClick={() =>
                request(`/v2/documents/${doc.id}/explain`)
                  .then(setExplanation)
                  .catch((e) => setErr(e.message))
              }
            >
              Explain report
            </button>
          )}
          <button className="btn ghost" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {err && <div className="empty">{err}</div>}
        {doc && (
          <div className="drawer-body">
            <div className="drawer-file">
              {doc.mime.startsWith("audio/") ? (
                <audio controls src={doc.file_url} />
              ) : doc.mime === "text/plain" ? (
                <pre className="care-pre">{doc.ocr_text}</pre>
              ) : doc.geometry?.length ? (
                <>
                  <div
                    className="row wrap"
                    style={{ padding: 8, background: "#fff" }}
                  >
                    <label className="field">
                      Page
                      <select
                        className="select"
                        value={page}
                        onChange={(e) => setPage(Number(e.target.value))}
                      >
                        {doc.geometry.map((_, i) => (
                          <option key={i} value={i}>
                            {i + 1}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      Find on original
                      <input
                        className="input"
                        value={focus}
                        onChange={(e) => setFocus(e.target.value)}
                        placeholder="Tap a lab value or type text"
                      />
                    </label>
                  </div>
                  <div style={{ position: "relative", lineHeight: 0 }}>
                    <img
                      style={{ width: "100%", maxWidth: "100%" }}
                      src={`/api/documents/${doc.id}/page/${page}?token=${token}`}
                      alt={`${doc.title}, page ${page + 1}`}
                      onError={() =>
                        setErr(
                          "Page could not load. Reopen the document to refresh access.",
                        )
                      }
                    />
                    {boxes.map((b, i) => (
                      <span
                        key={i}
                        style={{
                          position: "absolute",
                          left: `${b.x * 100}%`,
                          top: `${b.y * 100}%`,
                          width: `${b.w * 100}%`,
                          height: `${b.h * 100}%`,
                          background: "#ffe05280",
                          outline: "2px solid #f1b922",
                          pointerEvents: "none",
                        }}
                      />
                    ))}
                  </div>
                  <p className="small muted" style={{ padding: 10 }}>
                    Viewer: {doc.viewer}.{" "}
                    {boxes.length
                      ? `${boxes.length} source position(s) highlighted.`
                      : focus
                        ? "No exact OCR position found on this page; verify the original."
                        : "Tap a lab value to locate it on this page."}
                  </p>
                </>
              ) : isPdf ? (
                <iframe title={doc.title} src={doc.file_url} />
              ) : (
                <img src={doc.file_url} alt={doc.title} />
              )}
            </div>
            <div className="drawer-text">
              <div className="row" style={{ marginBottom: 8 }}>
                <ScanText size={16} />
                <h3>Text the system read</h3>
                <div className="spacer" />
                <span className={`chip ${lowOcr ? "warning" : "ok"}`}>
                  {doc.ocr_method === "pdf-text"
                    ? "Digital PDF text"
                    : `OCR ${doc.ocr_confidence ?? "–"}% confidence`}
                </span>
              </div>
              {lowOcr && (
                <p
                  className="small"
                  style={{ color: "var(--warning)", marginBottom: 8 }}
                >
                  Low-quality scan. Read the original on the left before relying
                  on this text.
                </p>
              )}
              {explanation && (
                <div className="care-notice">
                  <h3>Plain-language explanation · {explanation.source}</h3>
                  {explanation.explanation.map((x, i) => (
                    <p key={i}>{x.text}</p>
                  ))}
                  {!explanation.explanation.length && (
                    <p>{explanation.original_excerpt}</p>
                  )}
                  <b>Questions for your doctor</b>
                  {explanation.questions.map((q) => (
                    <p key={q}>{q}</p>
                  ))}
                </div>
              )}
              {doc.lab_values?.length > 0 && (
                <table className="list" style={{ marginBottom: 12 }}>
                  <thead>
                    <tr>
                      <th>Test</th>
                      <th>Value</th>
                      <th>Reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {doc.lab_values.map((l) => (
                      <tr key={l.test}>
                        <td>{l.test}</td>
                        <td
                          className="num"
                          style={{
                            color: l.flag ? "var(--critical)" : undefined,
                            fontWeight: l.flag ? 600 : 400,
                          }}
                        >
                          <button
                            className="src"
                            onClick={() => setFocus(String(l.value))}
                          >
                            {l.value} {l.unit} {l.flag && `(${l.flag})`}
                          </button>
                        </td>
                        <td className="num muted">
                          {l.ref_low}–{l.ref_high}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="ocr">
                {doc.ocr_text || "No text could be read from this file."}
              </div>
              <p className="tiny muted" style={{ marginTop: 10 }}>
                Filed at <code>{doc.folder_path}</code>
              </p>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
