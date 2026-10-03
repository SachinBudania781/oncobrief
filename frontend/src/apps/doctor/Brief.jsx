import { AlertOctagon, AlertTriangle, Info, Clock, Footprints, CalendarClock, MessageCircleQuestion } from 'lucide-react'
import { fmtDate, fmtShort, fmtTime, LANG_LABEL } from '../../api'
import LabChart from '../../components/LabChart'
import Journey from './Journey'

export function Sources({ ids, onOpen }) {
  return (ids || []).map((s) =>
    s.startsWith('D')
      ? <button key={s} className="src" onClick={() => onOpen(s)} title="Open the original document">{s}</button>
      : <span key={s} className="src static" title={s.startsWith('S') ? 'Patient symptom report' : s}>{s.startsWith('S') ? 'Patient app' : s}</span>
  )
}

const ALERT_ICON = { critical: AlertOctagon, warning: AlertTriangle, info: Info }
const LAB_ORDER = ['Haemoglobin', 'ANC', 'Platelets', 'WBC', 'CEA', 'CA 15-3', 'ALT', 'Creatinine']

function Grade({ g }) {
  return <span className={`grade ${g >= 3 ? 'g3' : ''}`} aria-label={`grade ${g}`}>{[1, 2, 3].map((i) => <i key={i} className={i <= g ? 'on' : ''} />)}</span>
}

export default function Brief({ data, onOpen }) {
  const c = data.content
  const p = data.patient
  const labs = LAB_ORDER.filter((t) => c.labs[t]).slice(0, 6)
  const sinceLabel = c.visit_type === 'follow_up' ? `since last visit (${fmtDate(c.since)})` : 'in the last 30 days'

  return (
    <div>
      <div className="pt-header">
        <div>
          <h1>{p.name}</h1>
          <div className="pt-facts" style={{ marginTop: 6 }}>
            <span><b>{p.age} {p.sex === 'F' ? 'F' : 'M'}</b></span>
            <span>ID <b className="num">{p.id}</b></span>
            {p.abha_id && <span>ABHA <b className="num">{p.abha_id}</b></span>}
            <span>Prefers <b>{LANG_LABEL[p.preferred_language] || p.preferred_language}</b></span>
          </div>
        </div>
        <div className="pt-facts" style={{ flexBasis: '100%' }}>
          <span><b>{p.cancer_type}</b></span>
          {p.stage && <span>{p.stage}</span>}
          {p.current_regimen && <span>{p.current_regimen}</span>}
        </div>
      </div>

      <div className="brief-meta">
        <span className="chip plum">{c.visit_label} brief</span>
        <span className="speed"><Clock size={13} style={{ verticalAlign: -2 }} /> Ready in {data.latency_ms < 1000 ? `${Math.max(data.latency_ms, 1)} ms` : `${(data.latency_ms / 1000).toFixed(1)} s`}</span>
        <span>{c.documents_in_folder} documents in folder · {c.chunks_retrieved} passages from {c.documents_read} retrieved</span>
        <span>Written by {data.model}</span>
      </div>

      <div className="brief-grid">
        <div className="stack">
          <section className="panel summary">
            <div className="panel-head"><h2>At a glance</h2></div>
            {c.summary.map((s, i) => <p key={i}>{s.text}<Sources ids={s.sources} onOpen={onOpen} /></p>)}
          </section>

          {c.alerts.length > 0 && (
            <section className="panel">
              <div className="panel-head"><h2>Needs attention</h2><span className="muted small">flagged by rules, not by AI</span></div>
              <ul className="alerts">
                {c.alerts.map((a, i) => {
                  const Icon = ALERT_ICON[a.level]
                  return <li key={i} className={a.level}><Icon size={18} /><span>{a.text}<Sources ids={a.sources} onOpen={onOpen} /></span></li>
                })}
              </ul>
            </section>
          )}

          <section className="panel">
            <div className="panel-head"><h2>Journey</h2><span className="muted small">every document by date — hover to preview, click to open</span></div>
            <Journey timeline={c.timeline} since={c.visit_type === 'follow_up' ? c.since : null} onOpen={onOpen} />
          </section>

          <section className="panel">
            <div className="panel-head"><h2>Key findings from the records</h2></div>
            <ul className="findings">
              {c.key_findings.map((f, i) => (
                <li key={i}>{f.date && <time>{fmtDate(f.date)}</time>}{f.text}<Sources ids={f.sources} onOpen={onOpen} /></li>
              ))}
            </ul>
          </section>

          <section className="panel">
            <div className="panel-head"><h2 className="pr-head">Reported by the patient</h2><span className="muted small">{sinceLabel}</span></div>
            {c.patient_reported.length === 0 && <p className="muted">No reports from the patient app in this period.</p>}
            {c.patient_reported.map((r) => (
              <div key={r.id} className="pr-item">
                <div className="row small muted"><span>{fmtDate(r.date)} {fmtTime(r.date)}</span><span>form in {LANG_LABEL[r.language] || r.language}</span>{r.flagged && <span className="chip warning">flagged</span>}</div>
                <div className="row wrap" style={{ marginTop: 6 }}>
                  {r.symptoms.map((s) => <span key={s.key} className="chip">{s.name}<Grade g={s.grade} /></span>)}
                </div>
                {r.missed_meds?.length > 0 && <p className="small" style={{ marginTop: 6, color: 'var(--warning)' }}>Missed: {r.missed_meds.join(', ')}</p>}
                {r.free_text && <p className="small" style={{ marginTop: 6 }}>“{r.free_text}”</p>}
              </div>
            ))}
            {c.open_items.length > 0 && (
              <div className="row small" style={{ marginTop: 12, color: 'var(--info)', alignItems: 'flex-start' }}>
                <MessageCircleQuestion size={16} /><span><b>Patient's questions for today:</b> {c.open_items.join(' · ')}</span>
              </div>
            )}
          </section>
        </div>

        <div className="stack">
          {labs.length > 0 && (
            <section className="panel">
              <div className="panel-head"><h2>Lab trends</h2><span className="muted small">band = reference range</span></div>
              <div className="labs-grid">
                {labs.map((t) => {
                  const pts = c.labs[t]; const last = pts[pts.length - 1]
                  return (
                    <div key={t} className="lab-card">
                      <div className="row">
                        <span className="small" style={{ fontWeight: 600 }}>{t}</span>
                        <span className="spacer" />
                        <span className={`v num ${last.flag}`}>{last.value}</span>
                        <span className="tiny muted">{last.unit}</span>
                      </div>
                      <div className="tiny muted">{pts.length} result{pts.length > 1 ? 's' : ''} · latest {fmtShort(last.date)}{last.doc && <button className="src" onClick={() => onOpen(last.doc)}>{last.doc}</button>}</div>
                      {pts.length > 1 && <LabChart points={pts} />}
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          <section className="panel">
            <div className="panel-head"><h2>Treatment</h2></div>
            {c.treatment.regimen && <p className="small" style={{ marginBottom: 10 }}>{c.treatment.regimen}</p>}
            <ul className="med-list">
              {c.treatment.notes.slice(-4).reverse().map((n) => (
                <li key={n.doc}><span className="muted tiny">{fmtDate(n.date)}</span><br />{n.title}<button className="src" onClick={() => onOpen(n.doc)}>{n.doc}</button></li>
              ))}
            </ul>
            {c.treatment.medicines.length > 0 && (
              <>
                <h3 style={{ marginTop: 14, marginBottom: 6 }}>Current medicines</h3>
                <ul className="med-list">
                  {c.treatment.medicines.map((m) => <li key={m.name}><b>{m.name} {m.dose}</b><br /><span className="small muted">{m.frequency} · {m.times.join(', ')}</span></li>)}
                </ul>
              </>
            )}
          </section>

          {(c.activity || c.upcoming.length > 0) && (
            <section className="panel">
              {c.activity && (
                <div style={{ marginBottom: c.upcoming.length ? 14 : 0 }}>
                  <div className="row" style={{ marginBottom: 4 }}><Footprints size={16} /><h3>Daily activity (phone)</h3></div>
                  <p className="small">Average <b className="num">{c.activity.avg_steps_last_7.toLocaleString('en-IN')}</b> steps/day this week,
                    vs <span className="num">{c.activity.avg_steps_prev_7.toLocaleString('en-IN')}</span> the week before · sleep {c.activity.avg_sleep_last_7} h</p>
                </div>
              )}
              {c.upcoming.length > 0 && (
                <>
                  <div className="row" style={{ marginBottom: 4 }}><CalendarClock size={16} /><h3>Booked</h3></div>
                  <ul className="med-list">
                    {c.upcoming.map((u, i) => <li key={i} className="small">{fmtShort(u.start)} {fmtTime(u.start)} · {u.department} · {u.room}</li>)}
                  </ul>
                </>
              )}
            </section>
          )}

          <section className="panel">
            <div className="panel-head"><h2>Sources cited</h2><span className="muted small">{data.sources.length}</span></div>
            <ul className="med-list">
              {data.sources.map((s) => (
                <li key={s.tag} className="small"><button className="src" style={{ marginLeft: 0, marginRight: 6 }} onClick={() => onOpen(s.tag)}>{s.tag}</button>{s.title} <span className="muted">· {fmtShort(s.date)}</span></li>
              ))}
            </ul>
          </section>
        </div>
      </div>
      <p className="disclaimer">{c.disclaimer}</p>
    </div>
  )
}
