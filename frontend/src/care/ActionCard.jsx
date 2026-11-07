import { useEffect, useState } from "react";
import { CalendarPlus, Check, ClipboardCheck, MessageSquareText, Video, MapPin } from "lucide-react";
import { request } from "./client";
import { googleCalendarUrl } from "./calendar";
import { toast } from "./toast";

const ACTION_WORDS = /\b(book|schedule|reschedule|appointment|follow[- ]?up|teleconsult|video (call|consult|visit)|google meet|remind|tell|message|notify|send|inform|task|ask the (nurse|navigator|dietitian|team)|assign)\b/i;
export const looksLikeAction = (text) => ACTION_WORDS.test(text);

const DEPARTMENTS = ["Medical Oncology OPD", "Day-care Chemotherapy", "Radiology", "Pathology", "Biochemistry & Haematology Lab", "Radiation Oncology", "Psycho-oncology"];
const ICON = { book_visit: CalendarPlus, notify_patient: MessageSquareText, care_task: ClipboardCheck };
const TITLE = { book_visit: "Book appointment", notify_patient: "Message patient", care_task: "Care-team task" };

export default function ActionCard({ plan }) {
  const [params, setParams] = useState(() => ({
    ...plan.params,
    start: plan.params.start ? plan.params.start.slice(0, 16) : plan.params.date ? `${plan.params.date}T10:00` : "",
    clinician_email: plan.params.clinician_email || safeGet("ob-clinician-email"),
  }));
  const [state, setState] = useState("draft"), [error, setError] = useState(""), [result, setResult] = useState(null);
  const Icon = ICON[plan.intent] || ClipboardCheck;
  const set = (key) => (e) => setParams((p) => ({ ...p, [key]: e.target.value }));
  const meet = params.mode === "google_meet";
  useEffect(() => { if (params.clinician_email) safeSet("ob-clinician-email", params.clinician_email); }, [params.clinician_email]);

  const confirm = async () => {
    setState("busy"); setError("");
    try {
      const body = { ...params, invitation_consent: meet };
      const out = await request("/v2/assistant/execute", "POST", { intent: plan.intent, patient_id: plan.patient_id, params: body });
      setResult(out); setState("done"); toast(out.message || "Done");
    } catch (e) { setError(e.message); setState("draft"); }
  };

  if (state === "done") {
    const appt = result.appointment ? { ...result.appointment, virtual_visit: result.virtual_visit || result.appointment.virtual_visit } : null;
    const link = appt?.virtual_visit?.meeting_url;
    return <div className="ob-action-card is-done">
      <div className="ob-action-head"><span className="ob-action-icon ok"><Check size={17} /></span><div><b>{result.message}</b><small>{plan.patient_name}</small></div></div>
      {appt && <div className="ob-action-links">
        {link && <a className="btn primary" href={link} target="_blank" rel="noreferrer"><Video size={15} />Open Google Meet</a>}
        <a className="btn" href={googleCalendarUrl(appt)} target="_blank" rel="noreferrer"><CalendarPlus size={15} />Add to my calendar</a>
      </div>}
    </div>;
  }

  return <div className="ob-action-card">
    <div className="ob-action-head"><span className="ob-action-icon"><Icon size={17} /></span><div><b>{TITLE[plan.intent]}</b><small>{plan.summary}</small></div></div>
    {plan.intent === "book_visit" && <div className="ob-action-fields">
      <div className="ob-action-toggle" role="radiogroup" aria-label="Visit type">
        <button type="button" role="radio" aria-checked={!meet} className={!meet ? "active" : ""} onClick={() => setParams((p) => ({ ...p, mode: "in_person" }))}><MapPin size={14} />In person</button>
        <button type="button" role="radio" aria-checked={meet} className={meet ? "active" : ""} onClick={() => setParams((p) => ({ ...p, mode: "google_meet" }))}><Video size={14} />Google Meet</button>
      </div>
      <label><span>Date and time</span><input className="input" type="datetime-local" step={1200} value={params.start} onChange={set("start")} required /></label>
      {!meet && <label><span>Department</span><select className="select" value={params.department} onChange={set("department")}>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}</select></label>}
      {meet && <>
        <label><span>Patient email (for the invite)</span><input className="input" type="email" placeholder="patient@email.com" value={params.patient_email || ""} onChange={set("patient_email")} /></label>
        <label><span>Your email</span><input className="input" type="email" placeholder="you@hospital.org" value={params.clinician_email || ""} onChange={set("clinician_email")} /></label>
      </>}
    </div>}
    {plan.intent === "notify_patient" && <label className="ob-action-fields"><span>Message to {plan.patient_name.split(" ")[0]}</span><textarea className="input" rows={3} value={params.message || ""} onChange={set("message")} /></label>}
    {plan.intent === "care_task" && <label className="ob-action-fields"><span>Task</span><textarea className="input" rows={3} value={params.task || ""} onChange={set("task")} /></label>}
    {error && <p className="care-error" role="alert">{error}</p>}
    <div className="ob-action-buttons">
      <button className="btn" onClick={() => setState("cancelled")} disabled={state === "busy" || state === "cancelled"}>{state === "cancelled" ? "Cancelled" : "Cancel"}</button>
      <button className="btn primary" onClick={confirm} disabled={state !== "draft" || (plan.intent === "book_visit" && !params.start)}>{state === "busy" ? "Working…" : plan.intent === "book_visit" ? "Confirm booking" : plan.intent === "notify_patient" ? "Send message" : "Create task"}</button>
    </div>
  </div>;
}

function safeGet(key) { try { return localStorage.getItem(key) || ""; } catch { return ""; } }
function safeSet(key, value) { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } }
