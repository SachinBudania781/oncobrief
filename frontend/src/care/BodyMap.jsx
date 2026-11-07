import { useId, useMemo, useState } from "react";
import { AlertTriangle, Check, Plus, Send, Trash2, X } from "lucide-react";
import { request, useResource, dateTime } from "./client";
import { Skeleton } from "./Extras";
import { toast } from "./toast";

const ARM = "M60 86 Q44 90 40 120 L30 200 Q28 228 34 246 L46 246 Q48 226 52 200 L60 150 Z";
const LEG = "M80 248 L99 248 L97 330 L95 410 Q95 428 85 428 L74 428 Q69 421 71 410 L69 330 Q67 282 80 248 Z";
const REGIONS = [
  { key: "head", label: "Head", c: [100, 40], el: (p) => <circle cx="100" cy="40" r="24" {...p} /> },
  { key: "chest", label: "Chest", c: [100, 96], el: (p) => <path d="M60 84 Q100 70 140 84 L141 150 L59 150 Z" {...p} /> },
  { key: "right_breast", label: "Right breast", c: [80, 124], el: (p) => <ellipse cx="80" cy="124" rx="15" ry="12" {...p} /> },
  { key: "left_breast", label: "Left breast", c: [120, 124], el: (p) => <ellipse cx="120" cy="124" rx="15" ry="12" {...p} /> },
  { key: "abdomen", label: "Stomach", c: [100, 180], el: (p) => <path d="M59 150 L141 150 L136 210 L64 210 Z" {...p} /> },
  { key: "pelvis", label: "Pelvis", c: [100, 228], el: (p) => <path d="M64 210 L136 210 Q139 236 121 248 L79 248 Q61 236 64 210 Z" {...p} /> },
  { key: "right_arm", label: "Right arm", c: [43, 175], el: (p) => <path d={ARM} {...p} /> },
  { key: "left_arm", label: "Left arm", c: [157, 175], el: (p) => <path d={ARM} transform="translate(200 0) scale(-1 1)" {...p} /> },
  { key: "right_leg", label: "Right leg", c: [84, 340], el: (p) => <path d={LEG} {...p} /> },
  { key: "left_leg", label: "Left leg", c: [116, 340], el: (p) => <path d={LEG} transform="translate(200 0) scale(-1 1)" {...p} /> },
];
const KINDS = ["Pain", "Burning", "Numbness or tingling", "Swelling", "Rash or skin change", "Cramps", "Lump"];
const SINCE = ["Today", "2–3 days", "About a week", "Longer"];
const tone = (s) => (s >= 7 ? "high" : s >= 4 ? "mid" : "low");
const toneColor = { low: "#22c55e", mid: "#f59e0b", high: "#ef4444" };

function Body({ marks = {}, heat = {}, onPick, selected }) {
  const id = useId().replace(/:/g, "");
  return <svg className="ob-body-svg" viewBox="0 0 200 440" role="img" aria-label="Body map. Choose where you feel it.">
    <defs>
      <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffffff" /><stop offset=".45" stopColor="#dde6ff" /><stop offset="1" stopColor="#9fb4f5" /></linearGradient>
      <radialGradient id={`${id}s`} cx=".35" cy=".25" r=".7"><stop offset="0" stopColor="#fff" stopOpacity=".95" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient>
      <filter id={`${id}glow`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="7" /></filter>
      <filter id={`${id}sh`} x="-20%" y="-10%" width="140%" height="130%"><feDropShadow dx="0" dy="10" stdDeviation="9" floodColor="#3b4a8a" floodOpacity=".22" /></filter>
    </defs>
    <ellipse cx="100" cy="434" rx="56" ry="6" fill="#3b4a8a" opacity=".12" />
    <rect x="90" y="60" width="20" height="16" rx="6" fill={`url(#${id}g)`} />
    <g filter={`url(#${id}sh)`}>
      {REGIONS.map((r) => <g key={r.key} className={`ob-region ${selected === r.key ? "selected" : ""} ${marks[r.key] ? "marked" : ""}`} onClick={() => onPick?.(r.key)} role={onPick ? "button" : undefined} tabIndex={onPick ? 0 : undefined} aria-label={r.label} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onPick?.(r.key)}>
        {r.el({ fill: `url(#${id}g)`, stroke: "#fff", strokeWidth: 1.6 })}
      </g>)}
    </g>
    <ellipse cx="88" cy="30" rx="9" ry="6" fill={`url(#${id}s)`} pointerEvents="none" />
    <path d="M70 92 Q84 86 96 90" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity=".8" fill="none" pointerEvents="none" />
    {REGIONS.map((r) => { const h = heat[r.key]; return h ? <g key={"h" + r.key} pointerEvents="none"><circle cx={r.c[0]} cy={r.c[1]} r={10 + h.score * 1.6} fill={toneColor[tone(h.score)]} opacity=".45" filter={`url(#${id}glow)`} /></g> : null; })}
    {REGIONS.map((r) => { const m = marks[r.key]; return m ? <g key={"m" + r.key} pointerEvents="none" className="ob-body-pin">
      <circle cx={r.c[0]} cy={r.c[1]} r="16" fill={toneColor[tone(m.score)]} opacity=".25" className="ob-pin-ring" />
      <circle cx={r.c[0]} cy={r.c[1]} r="10" fill={toneColor[tone(m.score)]} stroke="#fff" strokeWidth="2.5" />
      <text x={r.c[0]} y={r.c[1] + 3.6} textAnchor="middle" fontSize="10" fontWeight="700" fill="#fff">{m.score}</text>
    </g> : null; })}
  </svg>;
}

export default function BodyMap({ pid, user }) {
  const canReport = ["patient", "caregiver", "nurse"].includes(user.role);
  const history = useResource(`/v2/patients/${pid}/records?kind=pain`);
  const [marks, setMarks] = useState({}), [editing, setEditing] = useState(null), [busy, setBusy] = useState(false), [sent, setSent] = useState(null);
  const recent = useMemo(() => (history.data || []).filter((r) => Date.now() - new Date(r.created_at).getTime() < 30 * 864e5), [history.data]);
  const heat = useMemo(() => recent.reduce((acc, r) => { const k = r.data.site; acc[k] = { score: Math.max(acc[k]?.score || 0, r.data.score), count: (acc[k]?.count || 0) + 1 }; return acc; }, {}), [recent]);
  const label = (k) => REGIONS.find((r) => r.key === k)?.label || k;
  const pick = (key) => { if (!canReport) return; setEditing({ site: key, kind: marks[key]?.kind || "Pain", score: marks[key]?.score ?? 5, since: marks[key]?.since || "Today", note: marks[key]?.note || "" }); };
  const save = () => { setMarks((m) => ({ ...m, [editing.site]: editing })); setEditing(null); };
  const send = async () => {
    setBusy(true);
    try {
      const list = Object.values(marks);
      for (const m of list) await request(`/v2/patients/${pid}/records`, "POST", { kind: "pain", data: { site: m.site, score: Number(m.score), text: `${m.kind} · since ${m.since.toLowerCase()}${m.note ? ` · ${m.note}` : ""}` } });
      const urgent = list.some((m) => m.score >= 7);
      setSent({ urgent, count: list.length }); setMarks({}); history.refresh();
      toast(urgent ? "Your care team has been alerted" : "Sent to your care team");
    } catch (e) { toast(e.message, "error"); } finally { setBusy(false); }
  };
  const list = Object.values(marks);

  return <div className="ob-bodymap">
    <section className="ob-card ob-body-stage">
      <div className="ob-body-head">
        <h2>{canReport ? "Where do you feel it?" : "Reported symptoms · last 30 days"}</h2>
        <p>{canReport ? "Tap the body. Add as many spots as you need, then send them to your care team." : "Glow shows where the patient has reported symptoms; brighter red means more severe."}</p>
      </div>
      <div className="ob-body-wrap">
        <span className="ob-body-side">Right</span>
        <Body marks={marks} heat={canReport ? {} : heat} onPick={canReport ? pick : undefined} selected={editing?.site} />
        <span className="ob-body-side">Left</span>
      </div>
      <div className="ob-body-legend"><span><i style={{ background: toneColor.low }} />Mild</span><span><i style={{ background: toneColor.mid }} />Moderate</span><span><i style={{ background: toneColor.high }} />Severe</span></div>
    </section>

    <div className="stack">
      {sent && <section className={`ob-card ob-sent ${sent.urgent ? "urgent" : ""}`}>
        <span className="ob-action-icon">{sent.urgent ? <AlertTriangle size={18} /> : <Check size={18} />}</span>
        <div><b>{sent.urgent ? "Your care team has been alerted" : "Sent to your care team"}</b><small>{sent.urgent ? "A nurse will call you shortly. If it gets worse, press SOS or call the hospital." : "They'll review it before your next visit."}</small></div>
        <button className="btn icon-btn" aria-label="Dismiss" onClick={() => setSent(null)}><X size={16} /></button>
      </section>}

      {canReport && <section className="ob-card">
        <div className="ob-card-head"><span className="ob-chip">Your spots</span><span className="ob-progress-label">{list.length || ""}</span></div>
        {list.length ? <ul className="ob-mark-list">{list.map((m) => <li key={m.site}>
          <span className={`ob-sev sev-${tone(m.score)}`}>{m.score}</span>
          <button onClick={() => pick(m.site)}><b>{label(m.site)}</b><small>{m.kind} · {m.since}</small></button>
          <button className="btn icon-btn" aria-label={`Remove ${label(m.site)}`} onClick={() => setMarks((all) => { const n = { ...all }; delete n[m.site]; return n; })}><Trash2 size={15} /></button>
        </li>)}</ul> : <div className="ob-empty-state compact"><span className="neutral"><Plus size={20} /></span><b>Tap where you feel it</b><small>Pain, numbness, swelling, a rash or a lump.</small></div>}
        {list.length > 0 && <button className="ob-cta" onClick={send} disabled={busy}>{busy ? "Sending…" : `Send to my care team`}<span><Send size={17} /></span></button>}
      </section>}

      <section className="ob-card">
        <div className="ob-card-head"><span className="ob-chip">Recent reports</span></div>
        {!history.data ? <Skeleton lines={3} /> : recent.length ? <ul className="ob-mark-list">{recent.slice(0, 8).map((r) => <li key={r.id}>
          <span className={`ob-sev sev-${tone(r.data.score)}`}>{r.data.score}</span>
          <div><b>{label(r.data.site)}</b><small>{r.data.text || "Reported"} · {dateTime(r.created_at)}</small></div>
        </li>)}</ul> : <p className="muted small">Nothing reported in the last 30 days.</p>}
      </section>
    </div>

    {editing && <div className="ob-sheet-backdrop" onClick={() => setEditing(null)}>
      <div className="ob-sheet" role="dialog" aria-modal="true" aria-label={label(editing.site)} onClick={(e) => e.stopPropagation()}>
        <div className="ob-sheet-grip" />
        <div className="ob-sheet-head"><h3>{label(editing.site)}</h3><button className="ob-back" onClick={() => setEditing(null)} aria-label="Close"><X size={18} /></button></div>
        <p className="ob-sheet-label">What do you feel?</p>
        <div className="ob-chips">{KINDS.map((k) => <button key={k} className={editing.kind === k ? "active" : ""} onClick={() => setEditing({ ...editing, kind: k })}>{k}</button>)}</div>
        <p className="ob-sheet-label">How strong? <b className={`sev-text sev-${tone(editing.score)}`}>{editing.score} / 10 · {editing.score >= 7 ? "Severe" : editing.score >= 4 ? "Moderate" : editing.score > 0 ? "Mild" : "None"}</b></p>
        <input type="range" min="0" max="10" step="1" value={editing.score} onChange={(e) => setEditing({ ...editing, score: Number(e.target.value) })} className={`ob-range sev-${tone(editing.score)}`} aria-label="Severity" style={{ "--v": `${editing.score * 10}%` }} />
        <p className="ob-sheet-label">Since when?</p>
        <div className="ob-chips">{SINCE.map((k) => <button key={k} className={editing.since === k ? "active" : ""} onClick={() => setEditing({ ...editing, since: k })}>{k}</button>)}</div>
        <input className="input" placeholder="Anything else? (optional)" value={editing.note} onChange={(e) => setEditing({ ...editing, note: e.target.value })} maxLength={200} />
        <button className="ob-cta" onClick={save}>{marks[editing.site] ? "Update spot" : "Add this spot"}<span><Check size={18} /></span></button>
      </div>
    </div>}
  </div>;
}

export { Body as BodyFigure };
