import { LineChart, Line, XAxis, YAxis, ReferenceArea, Tooltip, ResponsiveContainer } from 'recharts'
import { fmtShort } from '../api'

// Small trend chart: shaded band = reference range, red dots = out of range.
export default function LabChart({ points, height = 70, color = 'var(--plum)' }) {
  const data = points.map((p) => ({ ...p, label: fmtShort(p.date) }))
  const lo = points[0]?.ref_low, hi = points[0]?.ref_high
  const vals = points.map((p) => p.value).concat([lo, hi].filter((v) => v != null))
  const min = Math.min(...vals), max = Math.max(...vals)
  const pad = (max - min) * 0.15 || 1
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
        {lo != null && hi != null && <ReferenceArea y1={lo} y2={hi} fill="var(--ok)" fillOpacity={0.09} stroke="none" />}
        <XAxis dataKey="label" hide />
        <YAxis domain={[min - pad, max + pad]} hide />
        <Tooltip formatter={(v, _n, item) => [`${v} ${item.payload.unit}`, item.payload.label]} labelFormatter={() => ''} />
        <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} isAnimationActive={false}
          dot={(p) => <circle key={p.key} cx={p.cx} cy={p.cy} r={3.5} fill={p.payload.flag ? 'var(--critical)' : color} stroke="#fff" strokeWidth={1} />} />
      </LineChart>
    </ResponsiveContainer>
  )
}
