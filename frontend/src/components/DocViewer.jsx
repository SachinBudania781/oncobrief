import { useEffect, useState } from 'react'
import { X, Download, ScanText } from 'lucide-react'
import { api, fmtDate, CATEGORY_COLORS } from '../api'

// Opens the ORIGINAL file next to its OCR text and tags — the brief is never the last word.
export default function DocViewer({ docId, onClose }) {
  const [doc, setDoc] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!docId) return
    setDoc(null)
    api.document(docId).then(setDoc).catch((e) => setErr(e.message))
  }, [docId])
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  if (!docId) return null
  const isPdf = doc?.mime === 'application/pdf'
  const lowOcr = doc?.ocr_confidence != null && doc.ocr_confidence < 75
  return (
    <>
      <div className="drawer-back" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Original document">
        <div className="drawer-head">
          <span className="dot" style={{ background: CATEGORY_COLORS[doc?.category] || 'var(--ink-3)', marginTop: 8 }} />
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: 18 }}>{doc ? doc.title : 'Loading…'} {doc && <span className="src static">{doc.tag}</span>}</h2>
            {doc && (
              <div className="row wrap small muted" style={{ marginTop: 4 }}>
                <span>{doc.category} / {doc.subtype}</span>
                <span>Report date {fmtDate(doc.record_date)}</span>
                <span>Uploaded by {doc.uploaded_by}</span>
                {doc.external_hospital && <span className="chip">{doc.external_hospital}</span>}
              </div>
            )}
          </div>
          <div className="spacer" />
          {doc && <a className="btn" href={doc.file_url} target="_blank" rel="noreferrer"><Download size={16} /> Original</a>}
          <button className="btn ghost" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        {err && <div className="empty">{err}</div>}
        {doc && (
          <div className="drawer-body">
            <div className="drawer-file">
              {isPdf ? <iframe title={doc.title} src={doc.file_url} /> : <img src={doc.file_url} alt={doc.title} />}
            </div>
            <div className="drawer-text">
              <div className="row" style={{ marginBottom: 8 }}>
                <ScanText size={16} />
                <h3>Text the system read</h3>
                <div className="spacer" />
                <span className={`chip ${lowOcr ? 'warning' : 'ok'}`}>
                  {doc.ocr_method === 'pdf-text' ? 'Digital PDF text' : `OCR ${doc.ocr_confidence ?? '–'}% confidence`}
                </span>
              </div>
              {lowOcr && <p className="small" style={{ color: 'var(--warning)', marginBottom: 8 }}>Low-quality scan. Read the original on the left before relying on this text.</p>}
              {doc.lab_values?.length > 0 && (
                <table className="list" style={{ marginBottom: 12 }}>
                  <thead><tr><th>Test</th><th>Value</th><th>Reference</th></tr></thead>
                  <tbody>
                    {doc.lab_values.map((l) => (
                      <tr key={l.test}>
                        <td>{l.test}</td>
                        <td className="num" style={{ color: l.flag ? 'var(--critical)' : undefined, fontWeight: l.flag ? 600 : 400 }}>
                          {l.value} {l.unit} {l.flag && `(${l.flag})`}
                        </td>
                        <td className="num muted">{l.ref_low}–{l.ref_high}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="ocr">{doc.ocr_text || 'No text could be read from this file.'}</div>
              <p className="tiny muted" style={{ marginTop: 10 }}>Filed at <code>{doc.folder_path}</code></p>
            </div>
          </div>
        )}
      </aside>
    </>
  )
}
