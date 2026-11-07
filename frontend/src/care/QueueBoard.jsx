import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Expand, HeartPulse, Volume2 } from "lucide-react";
import { useResource } from "./client";
import { wallClock } from "./calendar";

// Waiting-room display for a TV or tablet. Shows initials + last 4 ID digits only,
// so no full patient names appear on a public screen.
const token = (a) => `${a.patient_name.split(" ").map((w) => w[0]).join("").slice(0, 2)} · ${a.patient_id.slice(-4)}`;
const minutes = (iso) => { const [h, m] = iso.slice(11, 16).split(":").map(Number); return h * 60 + m; };

export default function QueueBoard({ onExit }) {
  const schedule = useResource("/schedule", 20000);
  const [now, setNow] = useState(new Date());
  const [dept, setDept] = useState("all");
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(t); }, []);
  const nowMin = schedule.data?.current_time ? minutes(schedule.data.current_time) : now.getHours() * 60 + now.getMinutes();
  const lanes = useMemo(() => {
    const appts = (schedule.data?.appointments || []).filter((a) => !["cancelled", "completed", "no_show"].includes(a.status) && !a.virtual_visit);
    const names = (schedule.data?.departments || []).filter((d) => dept === "all" || d === dept);
    return names.map((name) => {
      const list = appts.filter((a) => a.department === name).sort((a, b) => a.start.localeCompare(b.start));
      const current = list.find((a) => minutes(a.start) <= nowMin && minutes(a.end) > nowMin) || null;
      const upcoming = list.filter((a) => minutes(a.start) >= nowMin && a !== current).slice(0, 4);
      return { name, current, upcoming, room: (current || upcoming[0])?.room };
    }).filter((l) => l.current || l.upcoming.length);
  }, [schedule.data, dept, nowMin]);
  const announce = (lane) => {
    if (!lane.current || !window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(`Token ${token(lane.current).replace(" · ", ", ")}, please proceed to ${lane.name}, ${lane.room}.`);
    u.lang = "en-IN"; window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
  };
  return <div className="ob-queue">
    <header>
      <button className="ob-queue-exit" onClick={() => { if (document.fullscreenElement) document.exitFullscreen(); onExit(); }} aria-label="Back to workspace"><ArrowLeft size={20} /></button>
      <div className="ob-queue-brand"><span className="ob-mark"><HeartPulse size={20} strokeWidth={2.2} /></span>OncoBrief<small>Now serving</small></div>
      <select className="select" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department">{["all", ...(schedule.data?.departments || [])].map((d) => <option key={d} value={d}>{d === "all" ? "All departments" : d}</option>)}</select>
      <time>{now.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}</time>
      <button className="ob-queue-exit" onClick={() => document.documentElement.requestFullscreen?.()} aria-label="Full screen"><Expand size={19} /></button>
    </header>
    <div className="ob-queue-grid">
      {lanes.map((lane) => <section key={lane.name} className="ob-queue-lane">
        <h2>{lane.name}</h2>
        <div className={`ob-queue-now ${lane.current ? "" : "idle"}`}>
          <small>{lane.current ? `Now · ${lane.current.room}` : "Next up"}</small>
          <b>{lane.current ? token(lane.current) : lane.upcoming[0] ? token(lane.upcoming[0]) : "—"}</b>
          {lane.current && <button onClick={() => announce(lane)} aria-label={`Announce ${lane.name}`}><Volume2 size={18} />Call</button>}
        </div>
        <ol>{lane.upcoming.slice(lane.current ? 0 : 1).map((a) => <li key={a.id}><span>{token(a)}</span><time>{wallClock(a.start)}</time></li>)}</ol>
      </section>)}
      {schedule.data && !lanes.length && <p className="ob-queue-empty">No one is waiting right now.</p>}
      {!schedule.data && <p className="ob-queue-empty">Loading today's queue…</p>}
    </div>
    <footer>Please keep your token handy. You'll be called by token number and room.</footer>
  </div>;
}
