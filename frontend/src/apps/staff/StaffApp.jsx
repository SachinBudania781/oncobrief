import { useCallback, useEffect, useMemo, useState } from 'react'
import { Upload, CalendarRange, UserPlus, History, AlertOctagon, Printer, CheckCircle2 } from 'lucide-react'
import { api, setActor, fmtTime, fmtDate, todayISO, CATEGORY_COLORS } from '../../api'
import TopBar from '../../components/TopBar'
import UploadForm from '../../components/UploadForm'
import DocViewer from '../../components/DocViewer'

const START_H = 8, END_H = 17

function ScheduleBoard() {
  const [day, setDay] = useState(todayISO())
  const [data, setData] = useState(null)
  const [hl, setHl] = useState(null)
  useEffect(() => { api.schedule(day).then(setData) }, [day])
  const clashIds = useMemo(() => new Set((data?.clashes || []).flatMap((c) => c.ids)), [data])
  if (!data) return null
  const pos = (iso) => {
    const d = new Date(iso); const h = d.getHours() + d.getMinutes() / 60
    return ((h - START_H) / (END_H - START_H)) * 100
  }
  return (
    <div className="stack">
      <div className="row wrap">
        <h2>All departments, one day</h2>
        <span className="spacer" />
        <label className="row small">Day <input type="date" className="input" style={{ width: 170 }} value={day} onChange={(e) => setDay(e.target.value)} /></label>
      </div>
      {data.clashes.length > 0 ? (
        <ul className="clash-list">
          {data.clashes.map((c, i) => (
            <li key={i} onMouseEnter={() => setHl(c.ids)} onMouseLeave={() => setHl(null)}>
              <AlertOctagon size={18} /><span><b>{c.type === 'patient' ? 'Patient clash' : 'Room clash'}:</b> {c.text}</span>
            </li>
          ))}
        </ul>
      ) : <p className="small" style={{ color: 'var(--ok)' }}><CheckCircle2 size={14} style={{ verticalAlign: -2 }} /> No clashes on this day.</p>}
      <div className="panel board">
        <div className="board-inner">
          <div className="board-hours">
            {Array.from({ length: END_H - START_H + 1 }, (_, i) => (
              <span key={i} style={{ left: `${(i / (END_H - START_H)) * 100}%` }}>{String(START_H + i).padStart(2, '0')}:00</span>
            ))}
          </div>
          {data.departments.filter((d) => d !== 'Front desk / Records').map((dept) => {
            const items = data.appointments.filter((a) => a.department === dept)
            return (
              <div key={dept} className="board-row">
                <div className="label">{dept}<div className="tiny muted" style={{ fontWeight: 400 }}>{items.length} booked</div></div>
                <div className="lane">
                  {items.map((a) => {
                    const left = pos(a.start), width = Math.min(Math.max(pos(a.end) - left, 3.2), 100 - left)
                    return (
                      <div key={a.id} className={`slot ${clashIds.has(a.id) ? 'clash' : ''} ${hl?.includes(a.id) ? 'hl' : ''}`}
                        style={{ left: `${left}%`, width: `${width}%` }}
                        title={`${fmtTime(a.start)}–${fmtTime(a.end)} · ${a.patient_name} (${a.patient_id}) · ${a.room}${a.notes ? ' · ' + a.notes : ''}`}>
                        <b>{a.patient_name.split(' ')[0]}</b><br />{fmtTime(a.start)}{width > 6 ? ` · ${a.room}` : ''}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <p className="small muted">Every department sees the same board, so a patient booked for an echo at 10:15 is not also expected in OPD at 10:30 without someone noticing.</p>
    </div>
  )
}

function Register({ taxonomy }) {
  const [f, setF] = useState({ name: '', age: '', sex: 'F', phone: '', preferred_language: 'hi', cancer_type: '', abha_id: '', referred_from: '' })
  const [done, setDone] = useState(null)
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const submit = async (e) => {
    e.preventDefault(); setErr('')
    try {
      const p = await api.createPatient({ ...f, age: Number(f.age), abha_id: f.abha_id || null, referred_from: f.referred_from || null, treating_oncologist: 'Dr. R. Menon' })
      setDone(p)
    } catch (e2) { setErr(e2.message) }
  }
  return (
    <div className="staff-grid">
      <form className="panel stack" onSubmit={submit}>
        <h2>Register a new patient</h2>
        <p className="small muted">Creates the patient's folder and ID. ABHA is optional; Aadhaar is never stored.</p>
        <label className="field"><span>Full name</span><input className="input" required value={f.name} onChange={set('name')} /></label>
        <div className="grid2">
          <label className="field"><span>Age</span><input className="input" type="number" min="0" max="120" required value={f.age} onChange={set('age')} /></label>
          <label className="field"><span>Sex</span><select className="select" value={f.sex} onChange={set('sex')}><option value="F">Female</option><option value="M">Male</option><option value="O">Other</option></select></label>
        </div>
        <div className="grid2">
          <label className="field"><span>Mobile</span><input className="input" value={f.phone} onChange={set('phone')} placeholder="+91" /></label>
          <label className="field"><span>Preferred language</span><select className="select" value={f.preferred_language} onChange={set('preferred_language')}><option value="en">English</option><option value="hi">Hindi</option><option value="mr">Marathi</option></select></label>
        </div>
        <label className="field"><span>Reason for visit / suspected diagnosis</span><input className="input" value={f.cancer_type} onChange={set('cancer_type')} placeholder="e.g. Breast lump for evaluation" /></label>
        <div className="grid2">
          <label className="field"><span>ABHA number (optional)</span><input className="input" value={f.abha_id} onChange={set('abha_id')} placeholder="91-1234-5678-9012" /></label>
          <label className="field"><span>Referred by (optional)</span><input className="input" value={f.referred_from} onChange={set('referred_from')} /></label>
        </div>
        {err && <p className="small" style={{ color: 'var(--critical)' }}>{err}</p>}
        <button className="btn primary lg" type="submit">Create patient folder</button>
      </form>
      <div className="panel">
        {done ? (
          <div className="stack">
            <h2>Folder created</h2>
            <div className="qr-card">
              <img src={`/api/patients/${done.id}/qr`} alt={`QR code for ${done.id}`} />
              <div>
                <div style={{ fontSize: 22, fontWeight: 700 }} className="num">{done.id}</div>
                <div>{done.name}, {done.age}{done.sex}</div>
                {done.abha_id && <div className="small muted">ABHA {done.abha_id}</div>}
                <div className="small muted" style={{ marginTop: 6 }}>Print this on the hospital card. Every app finds the folder from this code.</div>
              </div>
            </div>
            <button className="btn" onClick={() => window.print()}><Printer size={16} /> Print card</button>
          </div>
        ) : (
          <div className="empty">The new patient's ID and QR card appear here.</div>
        )}
      </div>
    </div>
  )
}

function Activity({ department, refresh, onOpen, compact }) {
  const [docs, setDocs] = useState([])
  const [audit, setAudit] = useState([])
  useEffect(() => { api.recentDocuments(department).then(setDocs); api.audit().then(setAudit) }, [department, refresh])
  const uploads = (
      <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
        <div className="panel-head" style={{ padding: '16px 16px 0' }}><h2>Recent uploads</h2><span className="muted small">{department}</span></div>
        <table className="list">
          <thead><tr><th>Patient</th><th>Document</th><th>Report date</th><th>OCR</th></tr></thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id} className="click" onClick={() => onOpen(d.id)}>
                <td><b>{d.patient_name}</b><div className="tiny muted">{d.patient_id}</div></td>
                <td><span className="row"><i className="dot" style={{ background: CATEGORY_COLORS[d.category], borderRadius: 3 }} />{d.subtype}</span><div className="tiny muted">{d.uploaded_by}</div></td>
                <td className="num small">{fmtDate(d.record_date)}</td>
                <td className="small">{d.ocr_method === 'pdf-text' ? 'PDF text' : `${d.ocr_confidence ?? '–'}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {docs.length === 0 && <div className="empty">No uploads from this department yet.</div>}
      </div>
  )
  if (compact) return uploads
  return (
    <div className="staff-grid">
      {uploads}
      <div className="panel">
        <div className="panel-head"><h2>Access log</h2><span className="muted small">who opened or changed a folder</span></div>
        <ul className="med-list">
          {audit.slice(0, 18).map((a, i) => (
            <li key={i} className="small"><span className="muted num">{fmtTime(a.at)}</span> <b>{a.name}</b> ({a.role}) — {a.action.replaceAll('_', ' ')} {a.patient_id && <span className="muted">· {a.patient_id}</span>}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export default function StaffApp() {
  const [taxonomy, setTaxonomy] = useState(null)
  const [department, setDepartment] = useState(() => {
    try { return localStorage.getItem('ob-dept') || 'Biochemistry & Haematology Lab' } catch { return 'Biochemistry & Haematology Lab' }
  })
  const [tab, setTab] = useState('upload')
  const [refresh, setRefresh] = useState(0)
  const [docId, setDocId] = useState(null)
  useEffect(() => { api.taxonomy().then(setTaxonomy) }, [])
  useEffect(() => {
    setActor('staff', `${department} staff`)
    try { localStorage.setItem('ob-dept', department) } catch { /* private mode */ }
  }, [department])
  const onUploaded = useCallback(() => setRefresh((r) => r + 1), [])

  return (
    <div className="shell">
      <TopBar app="Staff">
        {taxonomy && (
          <select className="select dept-select" style={{ width: 250, height: 34 }} value={department} onChange={(e) => setDepartment(e.target.value)} aria-label="Department">
            {taxonomy.departments.map((d) => <option key={d.name}>{d.name}</option>)}
          </select>
        )}
      </TopBar>
      <div className="staff-wrap">
        <div className="tabs">
          <button className={tab === 'upload' ? 'active' : ''} onClick={() => setTab('upload')}><Upload size={15} /> Upload or scan</button>
          <button className={tab === 'schedule' ? 'active' : ''} onClick={() => setTab('schedule')}><CalendarRange size={15} /> Schedule board</button>
          <button className={tab === 'register' ? 'active' : ''} onClick={() => setTab('register')}><UserPlus size={15} /> Register patient</button>
          <button className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}><History size={15} /> Uploads and access log</button>
        </div>
        {!taxonomy ? null : tab === 'upload' ? (
          <div className="staff-grid">
            <div className="panel">
              <div className="panel-head"><h2>File a report</h2><span className="muted small">tagged to {department}</span></div>
              <UploadForm taxonomy={taxonomy} mode="staff" department={department} onUploaded={onUploaded} />
            </div>
            <div className="stack">
              <div className="panel">
                <h3 style={{ marginBottom: 8 }}>How filing works</h3>
                <ol className="small" style={{ paddingLeft: 18, margin: 0, display: 'grid', gap: 6 }}>
                  <li>Scan the patient's QR or type their ID.</li>
                  <li>Pick what the document is. Nothing is filed without a type and a date.</li>
                  <li>Scan the page or drop the file. The system reads the text (OCR) and files it in that patient's folder.</li>
                  <li>Lab values are read and checked against reference ranges by fixed rules. AI is not used here.</li>
                </ol>
              </div>
              <Activity department={department} refresh={refresh} onOpen={setDocId} compact />
            </div>
          </div>
        ) : tab === 'schedule' ? <ScheduleBoard /> : tab === 'register' ? <Register taxonomy={taxonomy} /> : <Activity department={department} refresh={refresh} onOpen={setDocId} />}
      </div>
      {docId && <DocViewer docId={docId} onClose={() => setDocId(null)} />}
    </div>
  )
}
