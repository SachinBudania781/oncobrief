import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CalendarClock, Droplets, Moon, Phone, ShieldAlert, Sparkles, Sun, Thermometer, Utensils } from "lucide-react";
import { useResource } from "./client";
import { Skeleton } from "./Extras";
import { useTilt } from "./Glass3D";

/* A general chemotherapy-cycle pattern (nausea early, tiredness next, low blood counts mid-cycle,
   then recovery), scaled to the cycle length the doctor recorded. The treating team's notes come first. */
const PHASES = [
  { key: "infusion", from: 0, to: 0.15, name: "Treatment days", color: "#a66bff", icon: Droplets, tips: ["Take anti-sickness medicine on time, before you feel sick", "Small, frequent meals; sip fluids all day", "Rest after treatment; skip heavy chores"] },
  { key: "fatigue", from: 0.15, to: 0.33, name: "Tiredness peak", color: "#5b8cff", icon: Moon, tips: ["Plan short rests between activities", "A 10-minute gentle walk helps energy", "Ask family to help with errands"] },
  { key: "nadir", from: 0.33, to: 0.67, name: "Infection-risk window", color: "#ef4444", icon: ShieldAlert, tips: ["Check your temperature morning and evening", "Avoid crowds and people with colds; wash hands often", "Soft toothbrush and salt-water mouth rinse"] },
  { key: "recovery", from: 0.67, to: 1.01, name: "Recovery", color: "#10b981", icon: Sun, tips: ["Energy usually returns: good days for errands", "Eat well to rebuild strength before the next cycle", "Blood test before your next cycle, if booked"] },
];
const curves = {
  nausea: (x) => 0.92 * Math.exp(-((x - 0.05) ** 2) / 0.006) + 0.12 * Math.exp(-((x - 0.2) ** 2) / 0.01),
  fatigue: (x) => 0.85 * Math.exp(-((x - 0.25) ** 2) / 0.02) + 0.15,
  infection: (x) => 0.95 * Math.exp(-((x - 0.5) ** 2) / 0.012) + 0.04,
};
const CURVE_META = [["nausea", "Nausea", "#a66bff"], ["fatigue", "Tiredness", "#5b8cff"], ["infection", "Infection risk", "#ef4444"]];

function istToday() { const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })); d.setHours(0, 0, 0, 0); return d; }

export function useCycle(pid) {
  const res = useResource(pid ? `/v2/patients/${pid}/records?kind=roadmap` : null);
  const plan = (res.data || []).find((r) => r.status === "approved" && r.data.cycle_start) || (res.data || []).find((r) => r.data.cycle_start);
  const info = useMemo(() => {
    if (!plan) return null;
    const L = Math.max(7, Number(plan.data.cycle_days) || 21);
    const total = Number(plan.data.total_cycles) || null;
    const start = new Date(plan.data.cycle_start + "T00:00:00");
    const elapsed = Math.max(0, Math.round((istToday() - start) / 864e5));
    const extra = Math.floor(elapsed / L);
    const cycle = Math.min((Number(plan.data.cycle) || 1) + extra, total || 999);
    const finished = total && (Number(plan.data.cycle) || 1) + extra > total;
    const day = finished ? L : (elapsed % L) + 1;
    const x = (day - 0.5) / L;
    const phase = PHASES.find((p) => x >= p.from && x < p.to) || PHASES[3];
    const nextStart = new Date(start.getTime() + (extra + 1) * L * 864e5);
    return { L, total, cycle, day, x, phase, finished, nextStart, regimen: plan.data.regimen, notes: plan.data.side_effect_days, plan };
  }, [plan]);
  return { loading: !res.data && res.enabled, info, error: res.error };
}

export function CycleRing({ info, size = 150 }) {
  const r = 62, c = 2 * Math.PI * r;
  return <svg className="ob-cycle-ring" viewBox="0 0 160 160" width={size} height={size} aria-label={`Day ${info.day} of ${info.L}`}>
    <defs><linearGradient id="ob-ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff" /><stop offset="1" stopColor={info.phase.color} /></linearGradient></defs>
    <circle cx="80" cy="80" r={r} fill="none" stroke="rgba(255,255,255,.14)" strokeWidth="12" />
    {PHASES.map((p) => <circle key={p.key} cx="80" cy="80" r={r + 13} fill="none" stroke={p.color} strokeOpacity=".55" strokeWidth="3" strokeDasharray={`${(p.to - p.from) * 2 * Math.PI * (r + 13) - 4} 999`} strokeDashoffset={-p.from * 2 * Math.PI * (r + 13)} transform="rotate(-90 80 80)" />)}
    <circle cx="80" cy="80" r={r} fill="none" stroke="url(#ob-ring)" strokeWidth="12" strokeLinecap="round" strokeDasharray={`${(info.day / info.L) * c} ${c}`} transform="rotate(-90 80 80)" />
    <text x="80" y="76" textAnchor="middle" fontSize="34" fontWeight="700" fill="currentColor">{info.day}</text>
    <text x="80" y="98" textAnchor="middle" fontSize="12" fontWeight="600" fill="currentColor" opacity=".7">of {info.L} days</text>
  </svg>;
}

function Wave({ info }) {
  const id = useId().replace(/:/g, "");
  const box = useRef(null), [width, setWidth] = useState(640);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const W = width, H = width < 480 ? 170 : 200, pts = 80;
  const path = (fn, close) => {
    const d = Array.from({ length: pts + 1 }, (_, i) => { const x = i / pts; return `${i ? "L" : "M"}${(x * W).toFixed(1)} ${(H - 18 - fn(x) * (H - 40)).toFixed(1)}`; }).join(" ");
    return close ? `${d} L${W} ${H} L0 ${H} Z` : d;
  };
  const tx = info.x * W;
  return <div ref={box} className="ob-wave-box"><svg className="ob-wave" viewBox={`0 0 ${W} ${H + 26}`} width={W} height={H + 26} role="img" aria-label="Expected symptoms across the cycle">
    <defs>{CURVE_META.map(([k, , c]) => <linearGradient key={k} id={`${id}${k}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={c} stopOpacity=".32" /><stop offset="1" stopColor={c} stopOpacity="0" /></linearGradient>)}
      <filter id={`${id}gl`}><feGaussianBlur stdDeviation="4" /></filter></defs>
    {PHASES.map((p) => <rect key={p.key} x={p.from * W} y="0" width={(Math.min(p.to, 1) - p.from) * W} height={H} fill={p.color} opacity={info.phase.key === p.key ? 0.09 : 0.03} />)}
    {CURVE_META.map(([k, , c]) => <g key={k}><path d={path(curves[k], true)} fill={`url(#${id}${k})`} /><path d={path(curves[k])} fill="none" stroke={c} strokeWidth="2.6" strokeLinecap="round" /></g>)}
    <line x1={tx} x2={tx} y1="6" y2={H} stroke="#0b0d12" strokeWidth="1.5" strokeDasharray="4 4" />
    <circle cx={tx} cy={H - 18 - curves.infection(info.x) * (H - 40)} r="9" fill="#ef4444" filter={`url(#${id}gl)`} opacity=".7" />
    <circle cx={tx} cy={H - 18 - curves.infection(info.x) * (H - 40)} r="5" fill="#fff" stroke="#ef4444" strokeWidth="2.5" />
    <rect x={Math.min(Math.max(tx - 30, 0), W - 60)} y={H + 4} width="60" height="20" rx="10" fill="#0b0d12" />
    <text x={Math.min(Math.max(tx, 30), W - 30)} y={H + 18} textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff">Today</text>
  </svg></div>;
}

export default function CycleCompass({ pid, user }) {
  const { loading, info, error } = useCycle(pid);
  const [focus, setFocus] = useState(null);
  const tilt = useTilt(6);
  const patientView = ["patient", "caregiver"].includes(user.role);
  if (error) return <p className="care-error">{error}</p>;
  if (loading) return <Skeleton lines={6} />;
  if (!info) return <section className="ob-card ob-empty-state"><span className="neutral"><CalendarClock size={22} /></span><b>No treatment cycle recorded yet</b><small>{patientView ? "Your doctor adds this when your treatment plan is signed." : "Add a treatment roadmap with cycle start and length in Care plan."}</small></section>;
  const phase = focus ? PHASES.find((p) => p.key === focus) : info.phase;
  const PhaseIcon = phase.icon;
  const dayRange = (p) => `Days ${Math.max(1, Math.round(p.from * info.L) + 1)}–${Math.min(info.L, Math.round(Math.min(p.to, 1) * info.L))}`;
  return <div className="ob-cycle">
    <section className={`ob-hero ob-cycle-hero phase-${info.phase.key}`} ref={tilt}>
      <div>
        <span className="ob-hero-eyebrow"><Sparkles size={13} />Cycle {info.cycle}{info.total ? ` of ${info.total}` : ""} · Day {info.day} of {info.L}</span>
        <h2>{info.finished ? "All planned cycles complete" : info.phase.name}</h2>
        <p>{info.finished ? "Your team will plan what comes next." : info.phase.key === "nadir" ? "Your blood counts are usually lowest now, so infections can get serious quickly." : info.phase.key === "recovery" ? "Your body is rebuilding. Most people feel noticeably better now." : info.phase.key === "fatigue" ? "Tiredness often peaks now. It's expected and it passes." : "The first days after treatment. Sickness is most likely now."}</p>
        <div className="ob-hero-actions">
          {info.phase.key === "nadir" && patientView && <a className="ob-pill" href="tel:108"><Thermometer size={16} />Fever 38°C or more? Call now</a>}
          <span className="ob-pill ghost"><CalendarClock size={16} />Next cycle {info.nextStart.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}</span>
        </div>
      </div>
      <div className="ob-hero-art"><CycleRing info={info} size={170} /></div>
    </section>

    <section className="ob-card ob-wave-card">
      <div className="ob-card-head"><span className="ob-chip">What to expect this cycle</span><div className="ob-wave-legend">{CURVE_META.map(([k, l, c]) => <span key={k}><i style={{ background: c }} />{l}</span>)}</div></div>
      <Wave info={info} />
      <div className="ob-phase-tabs" role="tablist">{PHASES.map((p) => <button key={p.key} role="tab" aria-selected={phase.key === p.key} className={phase.key === p.key ? "active" : ""} style={{ "--pc": p.color }} onClick={() => setFocus(p.key === info.phase.key ? null : p.key)}><b>{p.name}</b><small>{dayRange(p)}{p.key === info.phase.key ? " · now" : ""}</small></button>)}</div>
    </section>

    <div className="ob-home-grid">
      <section className="ob-card ob-tips" style={{ "--pc": phase.color }}>
        <div className="ob-card-head"><span className="ob-chip"><PhaseIcon size={14} />{phase.key === info.phase.key ? "What helps today" : `During ${phase.name.toLowerCase()}`}</span></div>
        <ol>{phase.tips.map((t) => <li key={t}>{t}</li>)}</ol>
      </section>
      <section className="ob-card ob-call-card">
        <div className="ob-card-head"><span className="ob-chip"><Phone size={14} />Call the hospital straight away if</span></div>
        <ul>{["Temperature 38°C or higher, or shivering", "Breathless, chest pain, or bleeding that won't stop", "Vomiting for more than a day, or can't keep fluids down", "Diarrhoea more than 4 times a day"].map((t) => <li key={t}>{t}</li>)}</ul>
        {info.notes && <div className="ob-team-notes"><b>From your treatment team</b><p>{info.notes}</p></div>}
      </section>
    </div>
    <p className="ob-studio-note"><Utensils size={12} /> General pattern for many chemotherapy cycles, timed to your recorded cycle. Your treatment team's advice always comes first.</p>
  </div>;
}
