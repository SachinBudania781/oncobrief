import { useMemo, useState } from 'react'
import { CATEGORY_COLORS, fmtDate } from '../../api'

const LANES = [
  { key: 'Pathology', cats: ['Pathology'] },
  { key: 'Imaging', cats: ['Imaging'] },
  { key: 'Labs', cats: ['Lab report'] },
  { key: 'Treatment', cats: ['Treatment', 'Prescription'] },
  { key: 'Notes', cats: ['Clinical note', 'Patient-reported'] },
]
const GUTTER = 84
const LANE_Y = (i) => 22 + i * 30

// The patient's whole journey on one line: every document placed by date, marigold ring = new since last visit.
export default function Journey({ timeline, since, onOpen }) {
  const [tip, setTip] = useState(null)
  const { start, end, months } = useMemo(() => {
    const ts = timeline.map((t) => +new Date(t.date))
    const s = Math.min(...ts), e = Math.max(Date.now(), ...ts)
    const padMs = (e - s) * 0.04 + 2 * 86400000
    const st = s - padMs, en = e + padMs
    const ms = []
    const d = new Date(st); d.setDate(1); d.setMonth(d.getMonth() + 1)
    while (+d < en) { ms.push(new Date(d)); d.setMonth(d.getMonth() + 1) }
    const step = Math.ceil(ms.length / 10)
    return { start: st, end: en, months: ms.filter((_, i) => i % step === 0) }
  }, [timeline])
  const x = (iso) => `calc(${GUTTER}px + (100% - ${GUTTER + 12}px) * ${((+new Date(iso) - start) / (end - start)).toFixed(4)})`
  const sinceX = since ? x(since) : null

  return (
    <div className="journey">
      <div className="journey-scroll">
        <div className="journey-track" onMouseLeave={() => setTip(null)}>
          {sinceX && (
            <div className="journey-since" style={{ left: sinceX, right: 0 }}>
              <span>Since last visit</span>
            </div>
          )}
          {LANES.map((l, i) => (
            <div key={l.key}>
              <div className="journey-lane-label" style={{ top: LANE_Y(i) - 8 }}>{l.key}</div>
              <div style={{ position: 'absolute', left: GUTTER, right: 12, top: LANE_Y(i), height: 1, background: 'var(--line)' }} />
            </div>
          ))}
          <div className="journey-axis" style={{ left: GUTTER }} />
          {months.map((m) => (
            <div key={+m} className="journey-month" style={{ left: x(m.toISOString()) }}>
              {m.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })}
            </div>
          ))}
          {timeline.map((t) => {
            const lane = LANES.findIndex((l) => l.cats.includes(t.category))
            return (
              <button
                key={t.doc}
                className={`journey-dot ${t.new ? 'new' : ''} ${t.source === 'external' ? 'ext' : ''}`}
                style={{ left: x(t.date), top: LANE_Y(lane), background: CATEGORY_COLORS[t.category] }}
                onMouseEnter={(e) => {
                  const r = e.currentTarget.parentElement.getBoundingClientRect()
                  const b = e.currentTarget.getBoundingClientRect()
                  setTip({ t, left: Math.min(b.left - r.left + 10, r.width - 270), top: b.top - r.top + 14 })
                }}
                onFocus={(e) => {
                  const r = e.currentTarget.parentElement.getBoundingClientRect()
                  const b = e.currentTarget.getBoundingClientRect()
                  setTip({ t, left: Math.min(b.left - r.left + 10, r.width - 270), top: b.top - r.top + 14 })
                }}
                onBlur={() => setTip(null)}
                onClick={() => onOpen(t.doc)}
                aria-label={`${t.title}, ${fmtDate(t.date)}`}
              />
            )
          })}
          {tip && (
            <div className="journey-tip" style={{ left: tip.left, top: tip.top }}>
              <b>{tip.t.title}</b> <span style={{ opacity: .7 }}>{tip.t.doc}</span><br />
              <span style={{ opacity: .75 }}>{fmtDate(tip.t.date)}{tip.t.external_hospital ? ` · ${tip.t.external_hospital}` : ''}</span>
              <div style={{ marginTop: 4 }}>{tip.t.headline}</div>
            </div>
          )}
        </div>
      </div>
      <div className="legend">
        {Object.entries(CATEGORY_COLORS).map(([k, c]) => <span key={k}><i className="dot" style={{ background: c, borderRadius: 3 }} />{k}</span>)}
        <span><i className="dot" style={{ background: 'transparent', boxShadow: '0 0 0 2px var(--marigold)' }} />New since last visit</span>
        <span><i className="dot" style={{ background: 'var(--ink-3)' }} />Round = other hospital</span>
      </div>
    </div>
  )
}
