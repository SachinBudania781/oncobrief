import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { QrCode, Search, Loader2, FileStack, Sparkles, UserRound } from 'lucide-react'
import { api, setActor, fmtTime, VISIT_LABEL } from '../../api'
import TopBar from '../../components/TopBar'
import DocViewer from '../../components/DocViewer'
import QrScanner from '../../components/QrScanner'
import Brief from './Brief'
import Records from './Records'

const VISITS = [
  { key: 'new', label: 'New patient', hint: 'Referral, pathology so far, what is still missing' },
  { key: 'follow_up', label: 'Follow-up', hint: 'What changed since the last visit' },
  { key: 'transfer', label: 'Hospital transfer', hint: 'Full history from the other hospital' },
]

export default function DoctorApp() {
  const [params, setParams] = useSearchParams()
  const [taxonomy, setTaxonomy] = useState(null)
  const [queue, setQueue] = useState([])
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState([])
  const [patient, setPatient] = useState(null)
  const [suggested, setSuggested] = useState(null)
  const [visit, setVisit] = useState(null)
  const [brief, setBrief] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState('brief')
  const [docId, setDocId] = useState(null)
  const [qr, setQr] = useState(false)

  useEffect(() => {
    setActor('doctor', 'Dr. R. Menon')
    api.taxonomy().then(setTaxonomy)
    api.appointments({ department: 'Medical Oncology OPD' }).then(setQueue)
  }, [])

  const openPatient = useCallback(async (id, visitType) => {
    setErr(''); setBrief(null); setVisit(null); setTab('brief'); setMatches([])
    try {
      const p = await api.patient(id)
      setPatient(p)
      const appt = queue.find((a) => a.patient_id === p.id)
      setSuggested(visitType || appt?.visit_type || null)
      setParams({ patient: p.id })
    } catch (e) { setErr(e.message); setPatient(null) }
  }, [queue, setParams])

  const run = useCallback(async (p, v) => {
    setVisit(v); setLoading(true); setErr(''); setBrief(null); setTab('brief')
    try {
      const b = await api.brief(p.id, v)
      setBrief(b)
      setParams({ patient: p.id, visit: v })
    } catch (e) { setErr(e.message) } finally { setLoading(false) }
  }, [setParams])

  // deep links: /doctor?patient=OB-2026-0001&visit=follow_up
  useEffect(() => {
    const id = params.get('patient'), v = params.get('visit')
    if (id && !patient) {
      api.patient(id).then((p) => { setPatient(p); if (v) run(p, v) }).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const search = async (e) => {
    e?.preventDefault()
    const q = query.trim()
    if (!q) return
    const res = await api.patients(q)
    if (res.length === 1) openPatient(res[0].id)
    else if (res.length === 0) setErr(`No patient found for “${q}”.`)
    else setMatches(res)
  }

  return (
    <div className="shell" style={{ height: '100vh' }}>
      <TopBar app="Doctor"><span className="small muted hide-sm"><UserRound size={14} style={{ verticalAlign: -2 }} /> Dr. R. Menon · Medical Oncology</span></TopBar>
      <div className="doc-layout" style={{ minHeight: 0 }}>
        <aside className="queue">
          <h3 style={{ marginBottom: 2 }}>Today's clinic</h3>
          <p className="small muted" style={{ padding: '0 8px 10px' }}>{queue.length} patients · OPD-3 / OPD-4</p>
          {queue.map((a) => (
            <button key={a.id} className={`queue-item ${patient?.id === a.patient_id ? 'active' : ''}`} onClick={() => openPatient(a.patient_id, a.visit_type)}>
              <span className="t num">{fmtTime(a.start)}</span>
              <span>
                <span className="n">{a.patient_name}</span><br />
                <span className="small muted">{VISIT_LABEL[a.visit_type]} · {a.patient_id}</span>
              </span>
            </button>
          ))}
        </aside>

        <main className="doc-main">
          <form className="finder" onSubmit={search}>
            <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Patient ID, ABHA number or name" aria-label="Find patient" />
            <button className="btn" type="submit"><Search size={16} /> Find</button>
            <button className="btn primary" type="button" onClick={() => setQr(true)}><QrCode size={16} /> Scan patient QR</button>
          </form>
          {matches.length > 0 && (
            <div className="panel tight" style={{ marginTop: 10 }}>
              {matches.map((m) => <button key={m.id} className="btn ghost" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => openPatient(m.id)}>{m.name} · {m.id}</button>)}
            </div>
          )}
          {err && <p style={{ color: 'var(--critical)', marginTop: 10 }}>{err}</p>}

          {!patient && (
            <div className="panel" style={{ marginTop: 18 }}>
              <h2>Pick a patient from today's clinic, or scan their QR</h2>
              <p className="muted" style={{ marginTop: 6, maxWidth: 620 }}>
                OncoBrief reads everything already filed in the patient's folder — scans, outside reports, labs, notes and what the
                patient reported at home — and gives you one page with sources. It summarises; it does not diagnose or advise.
              </p>
            </div>
          )}

          {patient && !brief && (
            <section style={{ marginTop: 20 }}>
              <div className="row" style={{ marginBottom: 12 }}>
                <h2>{patient.name}</h2>
                <span className="muted">{patient.age}{patient.sex} · {patient.id} · {patient.document_count} documents in folder</span>
              </div>
              <p className="small muted" style={{ marginBottom: 10 }}>What kind of visit is this?</p>
              <div className="visit-types">
                {VISITS.map((v) => (
                  <button key={v.key} className={`visit-btn ${visit === v.key ? 'active' : ''}`} onClick={() => run(patient, v.key)} disabled={loading}>
                    <b>{v.label} {suggested === v.key && <span className="chip plum" style={{ marginLeft: 6 }}>booked as</span>}</b>
                    <span>{v.hint}</span>
                  </button>
                ))}
              </div>
              {loading && (
                <div className="panel" style={{ marginTop: 16 }}>
                  <div className="row"><Loader2 className="spin" size={18} /> <b>Reading {patient.document_count} documents and writing the brief…</b></div>
                </div>
              )}
            </section>
          )}

          {brief && (
            <section style={{ marginTop: 20 }}>
              <div className="tabs">
                <button className={tab === 'brief' ? 'active' : ''} onClick={() => setTab('brief')}><Sparkles size={15} /> Brief</button>
                <button className={tab === 'records' ? 'active' : ''} onClick={() => setTab('records')}><FileStack size={15} /> All records</button>
                <div className="spacer" />
                <div className="row" style={{ paddingBottom: 6 }}>
                  {VISITS.map((v) => (
                    <button key={v.key} className={`btn ${visit === v.key ? 'primary' : ''}`} style={{ height: 32, fontSize: 13 }} onClick={() => run(patient, v.key)}>{v.label}</button>
                  ))}
                </div>
              </div>
              {loading && <div className="row"><Loader2 className="spin" size={18} /> Re-writing the brief…</div>}
              {!loading && tab === 'brief' && <Brief data={brief} onOpen={(tag) => setDocId(Number(tag.slice(1)))} />}
              {tab === 'records' && taxonomy && <Records patientId={patient.id} taxonomy={taxonomy} onOpen={(tag) => setDocId(Number(tag.slice(1)))} />}
            </section>
          )}
        </main>
      </div>
      {docId && <DocViewer docId={docId} onClose={() => setDocId(null)} />}
      {qr && <QrScanner onClose={() => setQr(false)} onResult={(id) => { setQr(false); openPatient(id) }} />}
    </div>
  )
}
