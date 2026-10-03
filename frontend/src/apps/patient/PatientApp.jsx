import { useCallback, useEffect, useMemo, useState } from 'react'
import { Home, FolderOpen, Upload, HeartPulse, CalendarDays, CheckCircle2, AlertTriangle } from 'lucide-react'
import { BarChart, Bar, XAxis, ResponsiveContainer, Tooltip } from 'recharts'
import { api, setActor, fmtDate, fmtShort, fmtTime, todayISO, CATEGORY_COLORS, LANG_LABEL } from '../../api'
import TopBar from '../../components/TopBar'
import UploadForm from '../../components/UploadForm'
import DocViewer from '../../components/DocViewer'
import LabChart from '../../components/LabChart'
import { T } from './i18n'

function HomeTab({ p, t, onToast }) {
  const [meds, setMeds] = useState([])
  const [appts, setAppts] = useState([])
  const [act, setAct] = useState([])
  const load = useCallback(() => api.medications(p.id).then(setMeds), [p.id])
  useEffect(() => { load(); api.appointments({ patient_id: p.id, upcoming: true }).then(setAppts); api.activity(p.id).then(setAct) }, [p.id, load])
  const now = new Date(); const mins = now.getHours() * 60 + now.getMinutes()
  const doses = meds.flatMap((m) => m.today.map((d) => ({ ...d, m }))).sort((a, b) => a.time.localeCompare(b.time))
  const mark = async (m, time, status) => { await api.logMed({ medication_id: m.id, time, status }); load(); onToast(`${m.name} ${time}: ${status === 'taken' ? t.taken : t.missed}`) }
  const next = appts[0]
  return (
    <div className="stack">
      {next && (
        <div className="panel">
          <div className="small muted">{t.next}</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{fmtDate(next.start)}, {fmtTime(next.start)}</div>
          <div className="small">{next.department} · {next.room}</div>
        </div>
      )}
      <div className="panel">
        <h3 style={{ marginBottom: 6 }}>{t.meds}</h3>
        {doses.map((d) => {
          const [h, mm] = d.time.split(':').map(Number); const at = h * 60 + mm
          const soon = d.status === 'due' && at - mins <= 60 && at - mins >= -90
          return (
            <div key={d.m.id + d.time} className={`dose ${soon ? 'due-soon' : ''}`}>
              <span className="time num">{d.time}</span>
              <span><b>{d.m.name}</b> {d.m.dose}<br /><span className="tiny muted">{soon ? t.dueSoon : d.m.frequency}</span></span>
              <span className="seg">
                <button className={d.status === 'taken' ? 'on' : ''} onClick={() => mark(d.m, d.time, 'taken')}>{t.taken}</button>
                <button className={d.status === 'missed' ? 'on miss' : ''} onClick={() => mark(d.m, d.time, 'missed')}>{t.missed}</button>
              </span>
            </div>
          )
        })}
        {doses.length === 0 && <p className="small muted">—</p>}
      </div>
      <div className="panel" style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 12, alignItems: 'center' }}>
        <img src={`/api/patients/${p.id}/qr`} alt="My QR code" width="110" height="110" />
        <div><b>{t.myqr}</b><div className="num" style={{ fontWeight: 600 }}>{p.id}</div><div className="tiny muted">{t.showqr}</div></div>
      </div>
      {act.length > 0 && (
        <div className="panel">
          <h3>{t.activity}</h3>
          <ResponsiveContainer width="100%" height={90}>
            <BarChart data={act.map((a) => ({ ...a, d: fmtShort(a.date) }))} margin={{ top: 8, left: 0, right: 0, bottom: 0 }}>
              <XAxis dataKey="d" hide />
              <Tooltip formatter={(v) => [v.toLocaleString('en-IN'), 'steps']} />
              <Bar dataKey="steps" fill="var(--plum)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
          <div className="tiny muted">Synced from phone health app (simulated in this prototype)</div>
        </div>
      )}
    </div>
  )
}

function RecordsTab({ p, t, onOpen }) {
  const [docs, setDocs] = useState([])
  const [labs, setLabs] = useState({})
  useEffect(() => { api.documents(p.id).then(setDocs); api.labs(p.id).then(setLabs) }, [p.id])
  const shown = ['Haemoglobin', 'ANC', 'Platelets', 'CEA', 'CA 15-3'].filter((k) => labs[k]?.length > 1)
  return (
    <div className="stack">
      {shown.length > 0 && (
        <div className="panel">
          <h3 style={{ marginBottom: 6 }}>{t.labs}</h3>
          {shown.map((k) => {
            const pts = labs[k]; const last = pts[pts.length - 1]
            return (
              <div key={k} className="lab-card">
                <div className="row small"><b>{k}</b><span className="spacer" /><span className="num" style={{ color: last.flag ? 'var(--critical)' : undefined, fontWeight: 600 }}>{last.value} {last.unit}</span></div>
                <LabChart points={pts} height={56} />
              </div>
            )
          })}
        </div>
      )}
      <div className="panel" style={{ padding: 0 }}>
        <h3 style={{ padding: '14px 14px 4px' }}>{t.allDocs}</h3>
        {docs.map((d) => (
          <button key={d.id} onClick={() => onOpen(d.id)} className="btn ghost" style={{ width: '100%', height: 'auto', justifyContent: 'flex-start', padding: '10px 14px', borderRadius: 0, textAlign: 'left', borderTop: '1px solid var(--line)' }}>
            <i className="dot" style={{ background: CATEGORY_COLORS[d.category], borderRadius: 3 }} />
            <span style={{ minWidth: 0 }}><b style={{ fontWeight: 500 }}>{d.title}</b><br /><span className="tiny muted">{fmtDate(d.record_date)} · {d.subtype}</span></span>
          </button>
        ))}
      </div>
    </div>
  )
}

function ReportTab({ p, t, lang, symptoms, onToast }) {
  const [grades, setGrades] = useState({})
  const [meds, setMeds] = useState([])
  const [missed, setMissed] = useState([])
  const [text, setText] = useState('')
  const [result, setResult] = useState(null)
  useEffect(() => { api.medications(p.id).then(setMeds) }, [p.id])
  const labels = [t.none, t.mild, t.moderate, t.severe]
  const send = async () => {
    const r = await api.reportSymptoms({
      patient_id: p.id, language: lang, free_text: text, missed_meds: missed,
      symptoms: Object.entries(grades).map(([key, grade]) => ({ key, grade })),
    })
    setResult(r); setGrades({}); setMissed([]); setText('')
    onToast(t.sent)
  }
  return (
    <div className="stack">
      <div className="panel">
        <h3>{t.feel}</h3>
        <div className="tiny muted" style={{ marginBottom: 4 }}>0 {t.none} · 1 {t.mild} · 2 {t.moderate} · 3 {t.severe}</div>
        {symptoms.map((s) => (
          <div key={s.key} className="sym-row">
            <span className="small">{s[lang] || s.en}</span>
            <span className="grades" role="radiogroup" aria-label={s.en}>
              {[0, 1, 2, 3].map((g) => (
                <button key={g} type="button" title={labels[g]} aria-pressed={(grades[s.key] || 0) === g}
                  className={(grades[s.key] || 0) === g && g > 0 ? `on ${g === 3 ? 'g3' : ''}` : ''}
                  onClick={() => setGrades({ ...grades, [s.key]: g })}>{g}</button>
              ))}
            </span>
          </div>
        ))}
      </div>
      {meds.length > 0 && (
        <div className="panel">
          <h3 style={{ marginBottom: 6 }}>{t.missedQ}</h3>
          {meds.map((m) => (
            <label key={m.id} className="row small" style={{ padding: '6px 0' }}>
              <input type="checkbox" checked={missed.includes(`${m.name} ${m.dose}`)}
                onChange={(e) => setMissed(e.target.checked ? [...missed, `${m.name} ${m.dose}`] : missed.filter((x) => x !== `${m.name} ${m.dose}`))} />
              {m.name} {m.dose}
            </label>
          ))}
        </div>
      )}
      <div className="panel">
        <label className="field"><span>{t.other}</span><textarea className="input" value={text} onChange={(e) => setText(e.target.value)} /></label>
      </div>
      <button className="btn primary lg" onClick={send}>{t.send}</button>
      {result && (
        <div className={result.flagged ? 'panel' : 'filed'} style={result.flagged ? { background: 'var(--critical-tint)', borderColor: 'transparent' } : undefined}>
          {result.flagged ? <AlertTriangle size={18} color="var(--critical)" /> : <CheckCircle2 size={18} color="var(--ok)" />} <span className="small">{result.message}</span>
        </div>
      )}
    </div>
  )
}

function VisitsTab({ p, t, taxonomy, onOpen, onToast }) {
  const [appts, setAppts] = useState([])
  const [docs, setDocs] = useState([])
  const [dept, setDept] = useState('Medical Oncology OPD')
  const [day, setDay] = useState(todayISO())
  const [slots, setSlots] = useState([])
  const [slot, setSlot] = useState('')
  const load = useCallback(() => api.appointments({ patient_id: p.id, upcoming: true }).then(setAppts), [p.id])
  useEffect(() => { load(); api.documents(p.id, { subtype: 'Consultation transcript' }).then(setDocs) }, [p.id, load])
  useEffect(() => { setSlot(''); api.slots(dept, day).then(setSlots) }, [dept, day])
  const book = async () => {
    const r = await api.book({ patient_id: p.id, department: dept, start: `${day}T${slot}`, visit_type: 'follow_up' })
    onToast(r.clashes?.length ? `Booked — note: ${r.clashes[0].text}` : `Booked ${dept} ${fmtShort(r.start)} ${slot}`)
    setSlot(''); load(); api.slots(dept, day).then(setSlots)
  }
  return (
    <div className="stack">
      <div className="panel">
        <h3 style={{ marginBottom: 6 }}>{t.upcoming}</h3>
        <ul className="med-list">
          {appts.map((a) => <li key={a.id} className="small"><b>{fmtShort(a.start)} {fmtTime(a.start)}</b> · {a.department}<br /><span className="muted">{a.room}{a.notes ? ` · ${a.notes}` : ''}</span></li>)}
        </ul>
      </div>
      <div className="panel stack">
        <h3>{t.book}</h3>
        <label className="field"><span>{t.department}</span>
          <select className="select" value={dept} onChange={(e) => setDept(e.target.value)}>
            {taxonomy.departments.filter((d) => !d.name.startsWith('Front')).map((d) => <option key={d.name}>{d.name}</option>)}
          </select>
        </label>
        <label className="field"><span>{t.date}</span><input type="date" className="input" min={todayISO()} value={day} onChange={(e) => setDay(e.target.value)} /></label>
        <div>
          <div className="small" style={{ fontWeight: 500, color: 'var(--ink-2)', marginBottom: 5 }}>{t.slot}</div>
          <div className="row wrap">
            {slots.map((s) => <button key={s} className={`btn ${slot === s ? 'primary' : ''}`} style={{ height: 32 }} onClick={() => setSlot(s)}>{s}</button>)}
            {slots.length === 0 && <span className="small muted">{t.noSlots}</span>}
          </div>
        </div>
        <button className="btn primary" disabled={!slot} onClick={book}>{t.confirm}</button>
      </div>
      {docs.length > 0 && (
        <div className="panel">
          <h3 style={{ marginBottom: 6 }}>{t.transcripts}</h3>
          <ul className="med-list">
            {docs.map((d) => <li key={d.id}><button className="btn ghost" style={{ padding: 0, height: 'auto' }} onClick={() => onOpen(d.id)}>{d.title}</button><div className="tiny muted">{fmtDate(d.record_date)}</div></li>)}
          </ul>
        </div>
      )}
    </div>
  )
}

export default function PatientApp() {
  const [patients, setPatients] = useState([])
  const [pid, setPid] = useState('OB-2026-0001')
  const [p, setP] = useState(null)
  const [lang, setLang] = useState('en')
  const [tab, setTab] = useState('home')
  const [taxonomy, setTaxonomy] = useState(null)
  const [docId, setDocId] = useState(null)
  const [toast, setToast] = useState('')
  const onToast = useCallback((m) => { setToast(m); setTimeout(() => setToast(''), 3000) }, [])
  useEffect(() => { api.patients().then((ps) => setPatients(ps.slice(0, 5))); api.taxonomy().then(setTaxonomy) }, [])
  useEffect(() => {
    api.patient(pid).then((x) => { setP(x); setLang(x.preferred_language || 'en'); setActor('patient', x.name) })
  }, [pid])
  const t = T[lang] || T.en
  const tabs = useMemo(() => [
    ['home', Home, t.home], ['records', FolderOpen, t.records], ['upload', Upload, t.upload],
    ['report', HeartPulse, t.report], ['visits', CalendarDays, t.visits],
  ], [t])

  return (
    <div className="shell">
      <TopBar app="Patient" />
      <div className="patient-stage">
        <div className="phone">
          {p && taxonomy && (
            <>
              <div className="phone-head">
                <div className="row">
                  <div className="hello">{t.hello}, {p.name.split(' ')[0]}</div>
                  <span className="spacer" />
                  <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language"
                    style={{ background: 'rgba(255,255,255,.15)', color: '#fff', border: 0, borderRadius: 6, padding: '4px 6px' }}>
                    {Object.entries(LANG_LABEL).map(([k, v]) => <option key={k} value={k} style={{ color: '#000' }}>{v}</option>)}
                  </select>
                </div>
                <div className="tiny" style={{ opacity: .8 }}>{p.id}</div>
              </div>
              <div className="phone-body">
                {tab === 'home' && <HomeTab p={p} t={t} onToast={onToast} />}
                {tab === 'records' && <RecordsTab p={p} t={t} onOpen={setDocId} />}
                {tab === 'upload' && (
                  <div className="panel">
                    <h3>{t.uploadTitle}</h3>
                    <p className="tiny muted" style={{ marginBottom: 10 }}>{t.uploadHint}</p>
                    <UploadForm taxonomy={taxonomy} mode="patient" fixedPatientId={p.id} compact onUploaded={() => onToast('✓')} />
                  </div>
                )}
                {tab === 'report' && <ReportTab p={p} t={t} lang={lang} symptoms={taxonomy.symptoms} onToast={onToast} />}
                {tab === 'visits' && <VisitsTab p={p} t={t} taxonomy={taxonomy} onOpen={setDocId} onToast={onToast} />}
              </div>
              <nav className="phone-nav">
                {tabs.map(([k, Icon, label]) => (
                  <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}><Icon size={20} />{label}</button>
                ))}
              </nav>
            </>
          )}
          {toast && <div className="toast" role="status" style={{ position: 'absolute', bottom: 80 }}>{toast}</div>}
        </div>
        <aside className="patient-side">
          <h2>Patient app</h2>
          <p className="small muted" style={{ marginBottom: 14 }}>Works in any phone browser. Everything the patient logs here — symptoms, missed doses, outside reports — lands in their folder and shows up in the doctor's next brief.</p>
          <label className="field"><span>Demo: view as</span>
            <select className="select" value={pid} onChange={(e) => { setPid(e.target.value); setTab('home') }}>
              {patients.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.id}</option>)}
            </select>
          </label>
        </aside>
      </div>
      {docId && <DocViewer docId={docId} onClose={() => setDocId(null)} />}
    </div>
  )
}
