import { useState } from "react";
import { ArrowDownToLine, ArrowRight, ArrowUpRight, BookHeart, CalendarDays, Check, ChevronRight, ClipboardList, Clock3, FileStack, HeartHandshake, HeartPulse, History, LayoutDashboard, MessageCircle, Pill, ShieldCheck, Sparkles, Stethoscope, Users } from "lucide-react";
import { request, useResource, hospitalDateTime, nice } from "./client";
import { Action, Empty, Load, Panel, SourceLinks, Voice } from "./UI";
import { SmartInbox } from "./ClinicalTools";
import Brief from "../apps/doctor/Brief";
import CareMotif from "./CareMotif";

const ACTIONS = [
  ["records", FileStack, "Your reports", "Find, upload and understand"],
  ["clinical", Stethoscope, "Care journey", "Your treatment, together"],
  ["companion", MessageCircle, "Ask OncoBrief", "Answers from the patient record"],
  ["journal", BookHeart, "Plans & takeaways", "Keep the next steps close"],
  ["medicines", Pill, "Medicines", "Prescriptions and requests"],
  ["day", CalendarDays, "Appointments", "Your hospital day, organised"],
  ["schedule", LayoutDashboard, "Hospital schedule", "Visits and chair assignments"],
  ["staffActivity", History, "Recent activity", "Uploads and access history"],
];

export default function Dashboard({ pid, patient, user, can, onTab, onSelect, onOpen, visibleTabs = [] }) {
  const clinician = ["doctor", "nurse", "navigator", "frontdesk", "admin"].includes(user.role);
  const careTeam = !["patient", "caregiver"].includes(user.role);
  const portal = careTeam ? user.role === "doctor" ? "doctor" : "staff" : "patient";
  const command = useResource(clinician ? "/v2/command-centre" : null, 15000);
  const week = useResource(can("activity") ? `/v2/patients/${pid}/week` : null);
  const day = useResource(can("appointments") ? `/v2/patients/${pid}/day-pass` : null);
  const meds = useResource(can("medicines") ? `/patients/${pid}/medications` : null);
  const documents = useResource(visibleTabs.includes("records") && careTeam && !clinician ? `/patients/${pid}/documents` : null);
  const stats = (clinician ? [
    ["home", Users, command.data?.patients.length ?? "—", "Assigned patients", "Your care overview"],
    ...(user.role === "doctor" ? [["clinic", ClipboardList, "Today", "Clinic & visit briefs", "Prepare for the next visit"]] : []),
    ...(visibleTabs.includes("staffActivity") ? [["staffActivity", History, "Recent", "Uploads & access", "Review workspace activity"]] : []),
    ["approvals", ClipboardList, command.data?.awaiting_approval ?? "—", "Awaiting review", "Clinical requests"],
    ["triage", HeartPulse, command.data?.open_alerts ?? "—", "Open care alerts", "Review patient check-ins"],
    ["day", CalendarDays, day.data?.stops.length ?? "—", "Patient stops today", "Open the day pass"],
    ["schedule", LayoutDashboard, command.data?.chairs.length ?? "—", "Chair assignments", "View the schedule"],
    ["chat", HeartHandshake, "Together", "Care circle", "Open the conversation"],
    ["privacy", ShieldCheck, "Access", "Privacy & devices", "Review account access"],
  ] : careTeam ? [
    ["records", FileStack, documents.data?.length ?? "—", "Accessible reports", "Open patient records"],
    ["wellness", HeartPulse, "Care", "Patient wellbeing", "Open wellbeing"],
    ["journal", BookHeart, "Plans", "Shared care journal", "Review patient plans"],
    ["privacy", ShieldCheck, "Access", "Privacy & devices", "Review account access"],
  ] : [
    ["medicines", Pill, meds.data?.length ?? "—", "Medicines", "View your prescriptions"],
    ["day", CalendarDays, day.data?.stops.length ?? "—", "Appointments today", "See your day pass"],
    ["checkin", HeartPulse, week.data?.checkin_days ?? "—", "Check-ins this week", "A moment for yourself"],
    ["chat", HeartHandshake, "Together", "Your care circle", "Stay close to your team"],
  ]).filter(s => visibleTabs.includes(s[0])).slice(0, 4);
  const preferred = careTeam ? ({ doctor: "clinic", nurse: "triage", frontdesk: "schedule", admin: "schedule", lab: "records", navigator: "journal", dietitian: "wellness", privacy: "privacy" }[user.role]) : visibleTabs.includes("checkin") ? "checkin" : "day";
  const primaryTab = visibleTabs.includes(preferred) ? preferred : visibleTabs.find(t => t !== "home");
  const primaryLabel = { clinic: "Open clinic", triage: "Review care alerts", schedule: "Open schedule", records: "Open reports", journal: "Open care plans", wellness: "Open wellbeing", privacy: "Review access", checkin: "Start daily check-in", day: "View appointments" }[primaryTab] || "Open workspace";
  const stops = (day.data?.stops || []).filter(s => !["cancelled", "completed"].includes(s.status));
  const next = stops[0];
  const [brief, setBrief] = useState(null), [commandAnswer, setCommandAnswer] = useState(null);
  const voiceCommand = async text => {
    try {
      if (/brief/i.test(text)) setBrief(await request("/brief", "POST", { patient_id: pid, visit_type: "follow_up" }));
      else if (/cbc|blood count|सीबीसी/i.test(text)) {
        const docs = await request(`/patients/${pid}/documents?q=CBC`);
        setCommandAnswer({ answer: "The latest matching CBC records:", sources: docs.sort((a, b) => b.record_date.localeCompare(a.record_date)).slice(0, 3).map(d => ({ id: d.id, tag: d.tag, title: d.title })) });
      } else setCommandAnswer(await request(`/v2/patients/${pid}/companion`, "POST", { text, language: "en" }));
    } catch (e) { setCommandAnswer({ answer: e.message, sources: [] }); }
  };
  const shortcuts = ACTIONS.filter(([key]) => visibleTabs.includes(key)).slice(0, 4);
  return <div className="care-dashboard">
    <div className="dashboard-top-grid">
      <section className="dashboard-hero">
        <div className="dashboard-hero-copy">
          <span className="dashboard-kicker"><span className="care-connection-dot" />{portal === "patient" ? "WITH YOU, EVERY DAY" : portal === "doctor" ? "CARE WITH CLARITY" : "WORKING BETTER, TOGETHER"}</span>
          <h2>{portal === "patient" ? <>One step at a time.<br /><span>With your team beside you.</span></> : portal === "doctor" ? <>A clearer picture.<br /><span>More time for your patients.</span></> : <>Every detail connected.<br /><span>A smoother day of care.</span></>}</h2>
          <p>{portal === "patient" ? "Your records, your next steps, and the people who care. All here, whenever you need them." : portal === "doctor" ? "Patient stories, priorities and next decisions, brought into one considered workspace." : "Keep patient care moving, from the first check-in to the next handover."}</p>
          {primaryTab && <button className="btn primary dashboard-primary" onClick={() => onTab(primaryTab)}>{primaryLabel}<ArrowUpRight size={18} /></button>}
        </div>
        <CareMotif portal={portal} compact />
      </section>
      <section className="dashboard-context">
        <div className="dashboard-card-heading"><span className="dashboard-icon"><CalendarDays size={19} /></span><h2>{visibleTabs.includes("day") ? "Today’s care" : "Patient in focus"}</h2><span className="dashboard-live"><i />{visibleTabs.includes("day") ? "Today" : "Selected"}</span></div>
        {visibleTabs.includes("day") ? <>
          {day.error ? <p className="care-error" role="alert">{day.error}</p> : !day.data ? <p className="care-loading">Loading today’s care…</p> : next ? <div className="dashboard-next-visit"><span className="dashboard-next-label">NEXT IN YOUR DAY</span><h3>{next.department || next.type || "Hospital visit"}</h3><p><Clock3 size={15} />{hospitalDateTime(next.start || next.scheduled_at || next.date)}</p><small>{next.room || next.location || nice(next.status) || "Your care team is expecting you"}</small></div> : <div className="dashboard-day-clear"><span><Check size={24} strokeWidth={1.6} /></span><h3>No upcoming stops today</h3><p>Your appointments and visit details will appear here.</p></div>}
          <button className="dashboard-text-link" onClick={() => onTab("day")}>Open your day pass<ArrowRight size={16} /></button>
        </> : <div className="dashboard-patient-focus"><div className="dashboard-patient-avatar">{patient?.name?.slice(0, 1) || "—"}</div><h3>{patient?.name || "Select a patient"}</h3><p>{pid}</p><span>{patient?.cancer_type || "Assigned care folder"}</span>{visibleTabs.includes("clinical") && <button className="dashboard-text-link" onClick={() => onTab("clinical")}>View care journey<ArrowRight size={16} /></button>}</div>}
      </section>
    </div>
    <div className="care-section-label"><h2>{careTeam ? "Your workspace at a glance" : "A little overview of your day"}</h2><span className="dashboard-section-caption">{careTeam ? "Connected care" : "YOUR CARE, TOGETHER"}</span></div>
    <div className="care-summary-grid" style={{ "--stat-count": Math.max(stats.length, 1) }}>{stats.map(([key, Icon, value, label, detail]) => <button key={key} className="care-stat" onClick={() => onTab(key)}><span className="dashboard-stat-top"><span className="dashboard-icon"><Icon size={19} /></span><ArrowUpRight size={16} /></span><b className={typeof value === "string" && value.length > 6 ? "care-stat-word" : ""}>{value}</b><span>{label}</span><small>{detail}</small></button>)}</div>
    {clinician && <Panel title={["doctor", "nurse"].includes(user.role) ? "Patient priorities" : "Patient coordination"} hint="Ordered using recorded check-ins, alerts, missed doses, visits and activity changes. This supports team review; it is not a clinical prediction." action={<span className="dashboard-count">{command.data?.patients.length ?? "—"} patients</span>}>
      <Load resource={command}>{d => <div className="dashboard-priorities">{d.patients.map(p => <button className={`care-risk-row risk-${p.risk || "neutral"} ${pid === p.patient_id ? "is-selected" : ""}`} key={p.patient_id} aria-pressed={pid === p.patient_id} onClick={() => onSelect(p.patient_id)}><span className="dashboard-row-avatar">{p.name.slice(0, 1)}<i className="care-risk-dot" /></span><div><b>{p.name}</b><p>{p.reasons?.join(" · ") || `${p.patient_id} · No current flagged concern`}</p></div><span className="dashboard-patient-id">{p.patient_id}</span>{p.rescue && <span className="care-pill">Follow-up</span>}<ChevronRight size={17} /></button>)}{!d.patients.length && <Empty>No assigned patients yet.</Empty>}<details className="dashboard-hospital-details"><summary>Hospital overview<ChevronRight size={16} /></summary><div><p>{d.awaiting_approval ?? "—"} clinical requests await review.</p>{d.patients.map(p => <p key={p.patient_id}>{p.name}: {p.diagnosis_days ?? "unknown"} days since recorded diagnosis{p.rescue ? " · Follow-up requested" : ""}</p>)}{d.chairs.map(c => <p key={c.id}>Chair {c.data.chair}: {c.patient_id} · {c.data.prep}</p>)}</div></details></div>}</Load>
    </Panel>}
    <div className="dashboard-bottom-grid">
      <Panel title={careTeam ? "Keep care moving" : "Everything, a little closer"} action={<span className="dashboard-subtle-icon"><ArrowUpRight size={18} /></span>}><div className="dashboard-shortcuts">{shortcuts.map(([key, Icon, label, detail]) => <button key={key} onClick={() => onTab(key)}><span className="dashboard-icon"><Icon size={20} /></span><span><b>{label}</b><small>{detail}</small></span><ChevronRight size={17} /></button>)}</div></Panel>
      <Panel className="dashboard-care-card" title={user.role === "doctor" ? "Ready for the next visit" : careTeam ? "Care, in good hands" : "Your care. Your choices."} action={<span className="dashboard-subtle-icon">{user.role === "doctor" ? <Sparkles size={18} /> : <HeartHandshake size={19} />}</span>}>
        {user.role === "doctor" ? <><p className="dashboard-support-copy">Bring the patient story together in a concise, source-linked clinical brief.</p><Action className="btn primary" run={() => request("/brief", "POST", { patient_id: pid, visit_type: "follow_up" })} onDone={setBrief}>Build follow-up brief<ArrowUpRight size={16} /></Action>{brief && <Voice text={brief.content.summary.map(x => x.text).join(" ").split(/\s+/).slice(0, 140).join(" ")} />}<a className="dashboard-text-link" href={`/api/v2/patients/${pid}/pack.pdf`} target="_blank" rel="noreferrer"><ArrowDownToLine size={16} />Tumour board pack<ArrowUpRight size={15} /></a><details className="care-inline-help"><summary>Voice shortcuts</summary><p className="small muted">Say “build brief”, “show last three CBCs”, or ask a question about the chart.</p><Voice onText={voiceCommand} /></details>{commandAnswer && <div className="care-notice"><p>{commandAnswer.answer}</p><SourceLinks sources={commandAnswer.sources} onOpen={onOpen} /></div>}</> : <><div className="dashboard-care-symbol"><ShieldCheck size={33} strokeWidth={1.3} /></div><p className="dashboard-support-copy">{careTeam ? "Assigned patient folders and shared plans keep your team connected through every handover." : "Keep someone you trust close. You decide who can see your information, and can review access at any time."}</p><div className="row wrap">{visibleTabs.includes("circle") && <button className="btn" onClick={() => onTab("circle")}>Your care circle<ArrowUpRight size={16} /></button>}{visibleTabs.includes("privacy") && <button className="dashboard-text-link" onClick={() => onTab("privacy")}>Review access<ArrowRight size={16} /></button>}</div></>}
      </Panel>
    </div>
    {["doctor", "nurse"].includes(user.role) && <SmartInbox onSelect={onSelect} />}
    {brief && <Brief data={brief} onOpen={tag => onOpen(Number(tag.slice(1)))} />}
  </div>;
}
