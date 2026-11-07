import { useEffect, useState } from "react";
import { ArrowDownToLine, ArrowRight, CalendarPlus, Check, ChevronRight, ClipboardList, Clock3, FileStack, HeartHandshake, HeartPulse, History, LayoutDashboard, MapPin, MessageCircle, Pill, ShieldCheck, Sparkles, Stethoscope, Upload, Users, Video, BellRing, Smile, Meh, Frown, Laugh, Angry } from "lucide-react";
import { request, useResource, nice } from "./client";
import { Action, Empty, Load, PackActions, Panel, SourceLinks, Voice } from "./UI";
import { SmartInbox } from "./ClinicalTools";
import Brief from "../apps/doctor/Brief";
import { Skeleton } from "./Extras";
import { googleCalendarUrl, minutesUntil, wallClock, wallTimeLabel } from "./calendar";
import { toast } from "./toast";
import { GlassOrb, useTilt } from "./Glass3D";
import { CycleRing, useCycle } from "./CycleCompass";
import { BodyFigure } from "./BodyMap";
import { Mic, PersonStanding, Orbit } from "lucide-react";

const until = (mins) => {
  if (mins <= 0 && mins > -30) return "Now";
  if (mins < 0) return "Earlier today";
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h < 24) return `in ${h} h${m ? ` ${m} min` : ""}`;
  const d = Math.round(h / 24);
  return `in ${d} day${d > 1 ? "s" : ""}`;
};

export default function Dashboard(props) {
  const { user } = props;
  const careTeam = !["patient", "caregiver"].includes(user.role);
  return careTeam ? <TeamHome {...props} /> : <PatientHome {...props} />;
}

/* ---------------- Patient ---------------- */
function PatientHome({ pid, patient, can, onTab, visibleTabs = [] }) {
  const day = useResource(can("appointments") ? `/v2/patients/${pid}/day-pass` : null, 30000);
  const meds = useResource(can("medicines") ? `/patients/${pid}/medications` : null);
  const week = useResource(can("activity") ? `/v2/patients/${pid}/week` : null);
  const future = useResource(can("appointments") ? `/appointments?upcoming=true&patient_id=${encodeURIComponent(pid)}` : null, 60000);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((v) => v + 1), 60000); return () => clearInterval(t); }, []);
  const stops = (day.data?.stops || []).filter((s) => !["cancelled", "completed"].includes(s.status));
  const todayLeft = stops.filter((s) => minutesUntil(s.start) > -30);
  const later = (future.data || []).filter((a) => !todayLeft.some((s) => s.id === a.id) && minutesUntil(a.start) > -30);
  const upcoming = [...todayLeft, ...later];
  const next = upcoming[0];
  const isToday = next && todayLeft.includes(next);
  const doses = (meds.data || []).flatMap((m) => (m.today || []).map((d) => ({ ...d, med: m })));
  const taken = doses.filter((d) => d.status === "taken").length;
  const pct = doses.length ? Math.round((taken / doses.length) * 100) : 0;
  const markTaken = async (d) => {
    try {
      await request("/med-logs", "POST", { medication_id: d.med.id, time: d.time, status: "taken" });
      meds.refresh(); window.dispatchEvent(new Event("ob-dose-reminders-refresh"));
      toast(`${d.med.name} marked as taken`);
    } catch (e) { toast(e.message, "error"); }
  };
  const moods = [[Angry, "Very bad"], [Frown, "Not good"], [Meh, "Okay"], [Smile, "Good"], [Laugh, "Great"]];
  const checkins = useResource(visibleTabs.includes("checkin") ? `/v2/patients/${pid}/records?kind=checkin` : null);
  const cycle = useCycle(visibleTabs.includes("cycle") ? pid : null);
  const tilt = useTilt(7);
  const todayIso = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const checkedIn = (checkins.data || []).some((r) => new Date(r.created_at).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) === todayIso);
  const score = Math.round((doses.length ? (taken / doses.length) * 45 : 45) + (checkedIn ? 35 : 0) + (cycle.info?.phase.key === "nadir" ? 10 : 20));
  const orbColors = score >= 75 ? ["#c9fff0", "#34d1b0", "#2f6bff"] : score >= 50 ? ["#fff1c9", "#ffb547", "#ff6b9a"] : ["#ffe3f1", "#ff8fc2", "#8f6bff"];
  return <div className="ob-home">
    <section className="ob-hero ob-care-hero" ref={tilt}>
      <div>
        <span className="ob-hero-eyebrow">Today's care</span>
        <h2>{score >= 75 ? "You're on track today." : checkedIn ? "A couple of things left." : "Let's start your day."}</h2>
        <div className="ob-orb-legend">
          <div><i className={doses.length && taken === doses.length ? "ok" : "todo"}>{doses.length && taken === doses.length ? "✓" : "•"}</i>Medicines {doses.length ? `${taken} of ${doses.length} taken` : "none due today"}</div>
          <div><i className={checkedIn ? "ok" : "todo"}>{checkedIn ? "✓" : "•"}</i>{checkedIn ? "Check-in done" : "Check-in not done yet"}</div>
          {cycle.info && !cycle.info.finished && <div><i className={cycle.info.phase.key === "nadir" ? "todo" : "ok"}>{cycle.info.day}</i>Cycle day {cycle.info.day} · {cycle.info.phase.name.toLowerCase()}</div>}
        </div>
        <div className="ob-hero-actions">
          {!checkedIn && visibleTabs.includes("checkin") && <button className="ob-pill" onClick={() => onTab("checkin")}>Check in<ArrowRight size={16} /></button>}
          {visibleTabs.includes("bodymap") && <button className={checkedIn ? "ob-pill" : "ob-pill ghost"} onClick={() => onTab("bodymap")}><PersonStanding size={16} />Where does it hurt?</button>}
        </div>
      </div>
      <div className="ob-hero-art"><GlassOrb size={176} colors={orbColors} pulse><div className="ob-score"><b>{score}</b><small>care score</small></div></GlassOrb></div>
    </section>
    <div className="ob-home-grid">
      <section className="ob-card ob-next">
        <div className="ob-card-head"><span className="ob-chip"><Clock3 size={14} />Next appointment</span>{next && <span className={`ob-countdown ${minutesUntil(next.start) <= 30 ? "soon" : ""}`}>{until(minutesUntil(next.start))}</span>}</div>
        {day.error ? <p className="care-error">{day.error}</p> : !day.data || (future.enabled && !future.data) ? <Skeleton lines={3} /> : next ? <>
          <h2>{next.department}</h2>
          <p className="ob-next-meta"><span><Clock3 size={15} />{isToday ? `Today, ${wallClock(next.start)}` : wallTimeLabel(next.start)}</span>{next.virtual_visit ? <span><Video size={15} />Video consult</span> : <span><MapPin size={15} />{next.room}</span>}{next.clinician && !/pending/i.test(next.clinician) && <span><Stethoscope size={15} />{next.clinician}</span>}</p>
          {next.ahead > 0 && <p className="ob-next-wait">{next.ahead} {next.ahead === 1 ? "person" : "people"} ahead · about {next.wait_minutes} min wait</p>}
          <div className="ob-next-actions">
            {next.virtual_visit?.meeting_url && <a className="btn primary" href={next.virtual_visit.meeting_url} target="_blank" rel="noreferrer"><Video size={16} />Join video call</a>}
            <button className={next.virtual_visit?.meeting_url ? "btn" : "btn primary"} onClick={() => onTab("day")}>{isToday ? "View today's plan" : "All appointments"}<ArrowRight size={16} /></button>
            <a className="btn" href={googleCalendarUrl(next)} target="_blank" rel="noreferrer"><CalendarPlus size={16} />Add to calendar</a>
          </div>
          {upcoming.length > 1 && <ul className="ob-next-later">{upcoming.slice(1, 4).map((s) => <li key={s.id}><time>{todayLeft.includes(s) ? wallClock(s.start) : wallTimeLabel(s.start).replace(/,.*/, "")}</time><span>{s.department}</span><small>{s.virtual_visit ? "Video" : s.room}</small></li>)}</ul>}
        </> : <div className="ob-empty-state"><span><Check size={22} /></span><b>No upcoming appointments</b><small>New bookings will show up here.</small>{visibleTabs.includes("day") && <button className="btn" onClick={() => onTab("day")}>Book an appointment</button>}</div>}
      </section>

      <section className="ob-card ob-meds">
        <div className="ob-card-head"><span className="ob-chip"><Pill size={14} />Today's medicines</span>{doses.length > 0 && <span className="ob-progress-label">{taken} of {doses.length}</span>}</div>
        {!meds.enabled ? <Empty>Medicines aren't shared with this account.</Empty> : !meds.data ? <Skeleton lines={4} /> : doses.length ? <>
          <div className="ob-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct}%` }} /></div>
          <ul className="ob-dose-list">{doses.sort((a, b) => a.time.localeCompare(b.time)).map((d) => <li key={d.med.id + d.time} className={`is-${d.status}`}>
            <time>{d.time}</time><span><b>{d.med.name}</b><small>{d.med.dose}</small></span>
            {d.status === "taken" ? <span className="ob-dose-done"><Check size={15} />Taken</span> : d.status === "missed" ? <span className="ob-dose-missed">Missed</span> : <button className="btn ob-dose-btn" onClick={() => markTaken(d)}>Take</button>}
          </li>)}</ul>
        </> : <Empty>No medicines scheduled today.</Empty>}
        {visibleTabs.includes("medicines") && <button className="ob-link" onClick={() => onTab("medicines")}>All medicines and refills<ChevronRight size={16} /></button>}
      </section>
    </div>

    <div className="ob-feature-row">
      {cycle.info && <button className="ob-feature-card tone-cycle" onClick={() => onTab("cycle")}>
        <CycleRing info={cycle.info} size={104} />
        <div><span className="ob-chip light"><Orbit size={13} />Treatment cycle</span><b>{cycle.info.finished ? "Cycles complete" : cycle.info.phase.name}</b><small>Cycle {cycle.info.cycle}{cycle.info.total ? ` of ${cycle.info.total}` : ""} · see what to expect</small></div>
        <ChevronRight size={18} />
      </button>}
      {visibleTabs.includes("bodymap") && <button className="ob-feature-card tone-body" onClick={() => onTab("bodymap")}>
        <div className="ob-feature-body"><BodyFigure /></div>
        <div><span className="ob-chip"><PersonStanding size={13} />Symptom map</span><b>Show us where it hurts</b><small>Tap the body. Severe pain alerts your team.</small></div>
        <ChevronRight size={18} />
      </button>}
    </div>

    <div className="ob-quick-grid">
      {[["companion", MessageCircle, "Ask anything", "Reports, medicines, visits"], ["records", Upload, "Add a report", "Snap a photo or PDF"], ["chat", HeartHandshake, "Messages", "Your care circle"], ["share", ShieldCheck, "Emergency card", "Share in one tap"]]
        .filter(([key]) => visibleTabs.includes(key)).slice(0, 4)
        .map(([key, Icon, label, sub]) => <button key={key} className="ob-quick" onClick={() => onTab(key)}><span className="ob-quick-icon"><Icon size={20} /></span><b>{label}</b><small>{sub}</small></button>)}
    </div>

    {patient && <section className="ob-card ob-care-team">
      <div className="ob-card-head"><span className="ob-chip"><Stethoscope size={14} />Your treatment</span></div>
      <dl>
        <div><dt>Oncologist</dt><dd>{patient.treating_oncologist || "Being assigned"}</dd></div>
        <div><dt>Diagnosis</dt><dd>{patient.cancer_type || "—"}</dd></div>
        <div><dt>Current plan</dt><dd>{patient.current_regimen || "—"}</dd></div>
      </dl>
    </section>}
  </div>;
}

/* ---------------- Care team ---------------- */
const STATS = [
  ["patients", Users, "Patients", null],
  ["approvals", ClipboardList, "To review", "approvals"],
  ["alerts", BellRing, "Open alerts", "triage"],
  ["today", LayoutDashboard, "Visits today", "schedule"],
];

function TeamHome({ pid, patient, user, onTab, onSelect, onOpen, visibleTabs = [] }) {
  const clinician = ["doctor", "nurse", "navigator", "frontdesk", "admin"].includes(user.role);
  const command = useResource(clinician ? "/v2/command-centre" : null, 15000);
  const schedule = useResource(["doctor", "nurse", "frontdesk", "admin"].includes(user.role) ? "/schedule" : null, 30000);
  const [brief, setBrief] = useState(null), [commandAnswer, setCommandAnswer] = useState(null);
  const appts = (schedule.data?.appointments || []).filter((a) => a.status !== "cancelled");
  const mine = user.role === "doctor" ? appts.filter((a) => a.clinician === user.name) : appts;
  const nowIso = schedule.data?.current_time || "";
  const upcoming = mine.filter((a) => !nowIso || a.end.slice(0, 16) > nowIso).sort((a, b) => a.start.localeCompare(b.start));
  const values = { patients: command.data?.patients.length, approvals: command.data?.awaiting_approval, alerts: command.data?.open_alerts, today: user.role === "doctor" ? mine.length : appts.length };
  const stats = STATS.filter(([key, , , tab]) => (!tab || visibleTabs.includes(tab)) && (key !== "today" || schedule.enabled) && (key === "today" || clinician));
  const voiceCommand = async (text) => {
    try {
      if (/brief/i.test(text)) setBrief(await request("/brief", "POST", { patient_id: pid, visit_type: "follow_up" }));
      else setCommandAnswer(await request(`/v2/patients/${pid}/companion`, "POST", { text, language: "en" }));
    } catch (e) { setCommandAnswer({ answer: e.message, sources: [] }); }
  };
  const nextUp = upcoming[0];
  const nextPatient = nextUp ? command.data?.patients.find((p) => p.patient_id === nextUp.patient_id) : null;
  return <div className="ob-home">
    {user.role === "doctor" && <DoctorHero nextUp={nextUp} nextPatient={nextPatient} patient={patient} onTab={onTab} onSelect={onSelect} pid={pid} />}
    {stats.length > 0 && <div className="ob-stats">{stats.map(([key, Icon, label, tab]) => <button key={key} className="ob-stat" onClick={() => tab && onTab(tab)} disabled={!tab}>
      <span className="ob-stat-icon"><Icon size={18} /></span><b>{values[key] ?? <span className="ob-dash">–</span>}</b><span>{label}</span>
    </button>)}</div>}

    <div className="ob-home-grid">
      {clinician && <Panel title={["doctor", "nurse"].includes(user.role) ? "Patients needing attention" : "Patients"} className="ob-priorities" action={<span className="ob-muted-count">{command.data?.patients.length ?? ""}</span>}>
        {command.error ? <p className="care-error">{command.error}</p> : !command.data ? <Skeleton lines={5} /> : <div className="dashboard-priorities">
          {command.data.patients.map((p) => <button className={`care-risk-row risk-${p.risk || "neutral"} ${pid === p.patient_id ? "is-selected" : ""}`} key={p.patient_id} aria-pressed={pid === p.patient_id} onClick={() => onSelect(p.patient_id)}>
            <span className="dashboard-row-avatar">{p.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}<i className="care-risk-dot" /></span>
            <div><b>{p.name}</b><p>{p.reasons?.length ? p.reasons.join(" · ") : "No concerns flagged"}</p></div>
            {p.open_alerts > 0 && <span className="care-pill ob-pill-alert">{p.open_alerts} alert{p.open_alerts > 1 ? "s" : ""}</span>}
            {p.rescue && <span className="care-pill">Follow-up</span>}
            <ChevronRight size={17} />
          </button>)}
          {!command.data.patients.length && <Empty>No patients assigned yet.</Empty>}
        </div>}
      </Panel>}

      <div className="stack">
        {schedule.enabled && <Panel title={user.role === "doctor" ? "Your clinic today" : "Today's visits"} className="ob-agenda" action={visibleTabs.includes(user.role === "doctor" ? "clinic" : "schedule") && <button className="ob-link" onClick={() => onTab(user.role === "doctor" ? "clinic" : "schedule")}>Open<ChevronRight size={15} /></button>}>
          {!schedule.data ? <Skeleton lines={4} /> : upcoming.length ? <ol className="ob-agenda-list">{upcoming.slice(0, 6).map((a, i) => <li key={a.id} className={i === 0 ? "is-next" : ""}>
            <time>{wallClock(a.start)}</time>
            <button onClick={() => onSelect(a.patient_id)}><b>{a.patient_name}</b><small>{a.virtual_visit ? "Video consult" : `${a.department} · ${a.room}`}</small></button>
            {a.virtual_visit?.meeting_url ? <a className="btn icon-btn" href={a.virtual_visit.meeting_url} target="_blank" rel="noreferrer" aria-label="Join Google Meet"><Video size={16} /></a> : i === 0 ? <span className="ob-next-tag">Next</span> : null}
          </li>)}</ol> : <div className="ob-empty-state compact"><span><Check size={20} /></span><b>Nothing left today</b></div>}
        </Panel>}

        {["frontdesk", "nurse", "navigator", "admin"].includes(user.role) && <Panel title="Reduce no-shows" className="ob-remind">
          <p className="ob-brief-meta">Send every patient booked for tomorrow a reminder with their time, room and what to bring.</p>
          <Action className="btn primary" run={() => request("/v2/schedule/remind", "POST", {})} onDone={(r) => toast(r.patients ? `Reminders sent to ${r.patients} patient${r.patients > 1 ? "s" : ""} for ${new Date(r.day + "T00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}` : "No appointments booked for tomorrow")}><BellRing size={16} />Remind tomorrow's patients</Action>
        </Panel>}

        {user.role === "doctor" && patient && <Panel title={`Prepare for ${patient.name.split(" ")[0]}`} className="ob-brief-card">
          <p className="ob-brief-meta">{patient.cancer_type}{patient.stage ? ` · ${patient.stage}` : ""}</p>
          <div className="row wrap">
            <Action className="btn primary" run={() => request("/brief", "POST", { patient_id: pid, visit_type: "follow_up" })} onDone={(b) => { setBrief(b); toast("Brief ready"); }}><Sparkles size={16} />Build pre-visit brief</Action>
            <PackActions pid={pid} label="Tumour board pack" />
          </div>
          <details className="care-inline-help"><summary>Use voice</summary><p className="small muted">Say “build brief”, or ask a question about this patient.</p><Voice onText={voiceCommand} /></details>
          {commandAnswer && <div className="care-notice"><p>{commandAnswer.answer}</p><SourceLinks sources={commandAnswer.sources} onOpen={onOpen} /></div>}
        </Panel>}

        {!clinician && <Panel title="Shortcuts">
          <div className="dashboard-shortcuts">{[["records", FileStack, "Reports", "Find and upload"], ["journal", ClipboardList, "Care plans", "Shared plans"], ["wellness", HeartPulse, "Wellbeing", "Nutrition and support"], ["staffActivity", History, "Activity log", "Uploads and access"], ["privacy", ShieldCheck, "Privacy", "Sessions and access"]]
            .filter(([key]) => visibleTabs.includes(key)).map(([key, Icon, label, detail]) => <button key={key} onClick={() => onTab(key)}><span className="dashboard-icon"><Icon size={19} /></span><span><b>{label}</b><small>{detail}</small></span><ChevronRight size={17} /></button>)}</div>
        </Panel>}
      </div>
    </div>
    {["doctor", "nurse"].includes(user.role) && <SmartInbox onSelect={onSelect} />}
    {brief && <div className="ob-brief-output"><div className="row"><h2>Pre-visit brief · {patient?.name}</h2><span className="spacer" /><button className="btn" onClick={() => window.print()}>Print</button></div><Brief data={brief} onOpen={(tag) => onOpen(Number(tag.slice(1)))} /></div>}
  </div>;
}

function DoctorHero({ nextUp, patient, onTab, onSelect, pid }) {
  const tilt = useTilt(7);
  const who = nextUp ? nextUp.patient_name : patient?.name;
  const go = (tab) => { if (nextUp && nextUp.patient_id !== pid) onSelect(nextUp.patient_id); onTab(tab); };
  return <section className="ob-hero ob-doctor-hero" ref={tilt}>
    <div>
      <span className="ob-hero-eyebrow"><Clock3 size={13} />{nextUp ? `Next at ${wallClock(nextUp.start)}${nextUp.virtual_visit ? " · video" : ` · ${nextUp.room}`}` : "Selected patient"}</span>
      <h2>{who ? <>Ready for<br />{who}</> : "Your clinic is clear"}</h2>
      <p>{who ? "Open the cited brief, then record the consult. The note, patient summary and follow-up write themselves." : "No more patients scheduled today."}</p>
      {who && <div className="ob-hero-actions">
        <button className="ob-pill" onClick={() => go("scribe")}><Mic size={16} />Start consult</button>
        <button className="ob-pill ghost" onClick={() => go("clinic")}><Sparkles size={16} />Open brief</button>
      </div>}
    </div>
    <div className="ob-hero-art"><GlassOrb size={170} colors={["#efe6ff", "#8f6bff", "#3b25a8"]} pulse><div className="ob-score"><Mic size={40} /></div></GlassOrb></div>
  </section>;
}
