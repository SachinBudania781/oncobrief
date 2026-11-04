import { useEffect, useRef, useState } from "react";
import { Download, ScanText } from "lucide-react";
import { api, fmtDate } from "../api";
import { request } from "../care/client";
import Modal from "../care/Modal";

const GUIDANCE_LABELS = {
  en: { questions: "Questions to ask your doctor", redFlags: "Urgent symptoms", actionTeam: "Contact your oncology team now.", actionEmergency: "Go to the nearest emergency department now.", redFlagHint: "Get urgent help for these symptoms. Follow the action shown and contact your care team." },
  hi: { questions: "अपने डॉक्टर से पूछने के सवाल", redFlags: "तुरंत ध्यान देने वाले लक्षण", actionTeam: "अभी अपनी कैंसर देखभाल टीम से संपर्क करें।", actionEmergency: "अभी नज़दीकी आपातकालीन विभाग जाएँ।", redFlagHint: "इन लक्षणों पर तुरंत मदद लें। बताए गए कदम का पालन करें और अपनी देखभाल टीम से संपर्क करें।" },
  mr: { questions: "डॉक्टरांना विचारायचे प्रश्न", redFlags: "तातडीने लक्ष देण्याची लक्षणे", actionTeam: "आत्ताच तुमच्या कर्करोग उपचार पथकाशी संपर्क साधा.", actionEmergency: "आत्ताच जवळच्या आपत्कालीन विभागात जा.", redFlagHint: "या लक्षणांसाठी तातडीने मदत घ्या. दिलेली कृती करा आणि उपचार पथकाशी संपर्क साधा." },
};

// Opens the ORIGINAL file next to its OCR text and tags — the brief is never the last word.
export default function DocViewer({ docId, onClose }) {
  const [doc, setDoc] = useState(null);
  const [err, setErr] = useState("");
  const [page, setPage] = useState(0);
  const [focus, setFocus] = useState("");
  const [explanation, setExplanation] = useState(null);
  const [askedQuestions, setAskedQuestions] = useState({});
  const [explaining, setExplaining] = useState(false);
  const [language, setLanguage] = useState("en");
  const explanationRequest = useRef(0);
  const [view, setView] = useState("original");
  useEffect(() => {
    if (!docId) return;
    setDoc(null);
    setErr("");
    setPage(0);
    setFocus("");
    setExplanation(null);
    setAskedQuestions({});
    setExplaining(false);
    setLanguage("en");
    explanationRequest.current += 1;
    setView("original");
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
      explanationRequest.current += 1;
      clearInterval(timer);
    };
  }, [docId]);
  const explainReport = async () => {
    if (!doc || explaining) return;
    if (explanation?.requested_language === language) {
      setView("text");
      return;
    }
    const current = ++explanationRequest.current;
    setExplaining(true);
    setErr("");
    try {
      const result = await request(`/v2/documents/${doc.id}/explain?language=${language}`, "POST", {});
      if (current === explanationRequest.current) {
        setExplanation(result);
        setView("text");
      }
    } catch (e) {
      if (current === explanationRequest.current) setErr(e.message);
    } finally {
      if (current === explanationRequest.current) setExplaining(false);
    }
  };
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
    <Modal title={doc?.title || "Original document"} onClose={onClose} className="care-document-overlay">
        {doc && <div className="document-heading"><div className="document-metadata"><span className="care-pill">{doc.tag} · {doc.subtype}</span><span>{fmtDate(doc.record_date)}</span><span>{doc.external_hospital || doc.uploaded_by}</span></div><div className="document-actions"><a className="btn" href={doc.file_url} target="_blank" rel="noreferrer"><Download size={16} />Original file</a><select className="select" aria-label="Explanation language" value={language} disabled={explaining} onChange={(e) => { setLanguage(e.target.value); setExplanation(null); }}><option value="en">English</option><option value="hi">हिंदी</option><option value="mr">मराठी</option></select><button className="btn primary" disabled={explaining} aria-busy={explaining} onClick={explainReport}><ScanText size={16} />{explaining ? "Explaining…" : "Explain report"}</button></div></div>}
        <div className="document-mobile-tabs" aria-label="Document view"><button aria-pressed={view === "original"} className={view === "original" ? "active" : ""} onClick={() => setView("original")}>Original</button><button aria-pressed={view === "text"} className={view === "text" ? "active" : ""} onClick={() => setView("text")}>Extracted text</button></div>
        {err && <div className="empty">{err}</div>}
        {doc && (
          <div className={`drawer-body document-view-${view}`}>
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
                          background: "#49bdd44d",
                          outline: "2px solid #298ba3",
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
                  Low-quality scan. Read the original document before relying
                  on this text.
                </p>
              )}
              {explanation && (
                <div className="care-notice">
                  <h3>Plain-language explanation · {explanation.source}</h3>
                  <span className="small muted">{explanation.generation === "ai" ? "AI-assisted" : "From your records"}</span>
                  {explanation.explanation.map((x, i) => (
                    <p key={i}>{x.text}</p>
                  ))}
                  {!explanation.explanation.length && (
                    <p>{explanation.original_excerpt}</p>
                  )}
                  {explanation.patient_guidance && <>
                    {(() => {
                      const labels = GUIDANCE_LABELS[explanation.patient_guidance.language] || GUIDANCE_LABELS.en;
                      return <>
                    <p>{explanation.patient_guidance.what_this_means}</p>
                    <b>{labels.questions}</b>
                    {explanation.patient_guidance.what_to_ask_your_doctor.map((q, i) => (
                      <label key={i} className="field" style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 9, marginTop: 8 }}>
                        <input type="checkbox" checked={Boolean(askedQuestions[i])} onChange={(event) => setAskedQuestions((old) => ({ ...old, [i]: event.target.checked }))} />
                        <span>{q}</span>
                      </label>
                    ))}
                    {explanation.patient_guidance.emergency_red_flags.length > 0 && <div className="care-emergency" role="alert" style={{ marginTop: 16 }}>
                      <h2>{labels.redFlags}</h2>
                      <p>{labels.redFlagHint}</p>
                      <ul>{explanation.patient_guidance.emergency_red_flags.map((flag, i) => <li key={i}>
                        <b>{flag.symptom}</b> — {flag.action === "contact the oncology team now" ? labels.actionTeam : labels.actionEmergency}
                      </li>)}</ul>
                    </div>}
                      </>;
                    })()}
                  </>}
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

            </div>
          </div>
        )}
    </Modal>
  );
}

