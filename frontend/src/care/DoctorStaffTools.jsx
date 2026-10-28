import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileClock,
  FileStack,
  History,
  Search,
  Sparkles,
  UserRound,
} from "lucide-react";
import Brief from "../apps/doctor/Brief";
import { Empty, Error, Load, Panel } from "./UI";
import { dateTime, request, useResource } from "./client";

const VISITS = [
  ["new", "New patient", "Referral, pathology and what is missing"],
  ["follow_up", "Follow-up", "What changed since the last visit"],
  ["transfer", "Hospital transfer", "History from another hospital"],
];

function localDay() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function ClinicDesk({ patients = [], pid, onSelect, onOpen, onRecords }) {
  const day = localDay();
  const queue = useResource(
    `/appointments?day=${day}&department=${encodeURIComponent("Medical Oncology OPD")}`,
    30000,
  );
  const [query, setQuery] = useState("");
  const [visit, setVisit] = useState("follow_up");
  const [brief, setBrief] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const activePatient = patients.find((p) => p.id === pid);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return patients
      .filter((p) => [p.name, p.id, p.abha_id].some((v) => String(v || "").toLowerCase().includes(q)))
      .slice(0, 8);
  }, [patients, query]);
  const selectedAppointment = queue.data?.find((a) => a.patient_id === pid);
  useEffect(() => {
    if (selectedAppointment?.visit_type) setVisit(selectedAppointment.visit_type);
  }, [pid, selectedAppointment?.visit_type]);

  const choose = (id, visitType) => {
    onSelect(id);
    setBrief(null);
    setError("");
    setVisit(visitType || "follow_up");
    setQuery("");
  };

  const makeBrief = async () => {
    if (!pid) return;
    setBusy(true);
    setError("");
    try {
      setBrief(await request("/brief", "POST", { patient_id: pid, visit_type: visit }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="care-clinic-grid">
        <Panel
          title="Today’s oncology clinic"
          hint="Choose a scheduled patient to start a visit brief. The queue is limited to patients assigned to your account."
          action={<span className="care-inline-meta"><CalendarDays size={15} /> {new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>}
        >
          <Load resource={queue}>
            {(items) => items.length ? (
              <div className="care-clinic-queue">
                {items.map((a) => (
                  <button
                    type="button"
                    key={a.id}
                    className={`care-clinic-queue-item ${pid === a.patient_id ? "active" : ""}`}
                    onClick={() => choose(a.patient_id, a.visit_type)}
                  >
                    <span className="care-clinic-time"><Clock3 size={15} />{new Date(a.start).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
                    <span className="care-clinic-queue-name"><b>{a.patient_name}</b><small>{a.visit_type?.replaceAll("_", " ")} · {a.patient_id}</small></span>
                    <span className="care-clinic-room">{a.room || a.department}</span>
                  </button>
                ))}
              </div>
            ) : <Empty>No Medical Oncology OPD appointments are listed for today.</Empty>}
          </Load>
        </Panel>

        <div className="stack">
          <Panel title="Find an assigned patient" hint="Search is limited to patients already shared with your account.">
            <label className="care-clinic-search">
              <Search size={17} />
              <input
                className="input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Patient ID, ABHA or name"
                aria-label="Search assigned patients"
              />
            </label>
            {query.trim() && (
              <div className="care-clinic-matches">
                {matches.map((p) => <button key={p.id} onClick={() => choose(p.id)}><UserRound size={16} /><span><b>{p.name}</b><small>{p.id}{p.abha_id ? ` · ABHA ${p.abha_id}` : ""}</small></span><span>Open</span></button>)}
                {!matches.length && <p className="small muted">No matching assigned patient.</p>}
              </div>
            )}
          </Panel>

          <Panel title="Prepare visit brief" hint="Summarises available records and patient reports with source links. It supports review and does not diagnose or make treatment decisions.">
            {activePatient ? (
              <div className="care-clinic-patient">
                <div className="care-clinic-patient-head"><span className="care-clinic-avatar"><UserRound size={19} /></span><div><b>{activePatient.name}</b><small>{activePatient.age ?? "—"}{activePatient.sex ? ` · ${activePatient.sex}` : ""} · {activePatient.id}</small></div></div>
                {selectedAppointment && <p className="small muted">Scheduled {dateTime(selectedAppointment.start)} · {selectedAppointment.department} · {selectedAppointment.room}</p>}
                <div className="care-clinic-visits">
                  {VISITS.map(([key, label, hint]) => <button key={key} className={visit === key ? "active" : ""} onClick={() => { setVisit(key); setBrief(null); }}><b>{label}</b><small>{hint}</small></button>)}
                </div>
                <div className="row wrap care-clinic-actions">
                  <button className="btn primary" disabled={busy} onClick={makeBrief}><Sparkles size={16} />{busy ? "Preparing brief…" : brief ? "Refresh visit brief" : "Prepare visit brief"}</button>
                  <button className="btn" onClick={onRecords}><FileStack size={16} />Open records</button>
                </div>
                <Error message={error} />
              </div>
            ) : (
              <div className="care-clinic-empty"><span><UserRound size={21} /></span><b>Select a patient to begin</b><p>Choose someone from today’s queue or search patients assigned to you.</p></div>
            )}
          </Panel>
        </div>
      </div>

      {brief && <Panel title="Visit brief" hint="Each item includes a source link where the record supports it." action={<span className="care-inline-meta"><CheckCircle2 size={15} /> Ready for review</span>}><Brief data={brief} onOpen={onOpen} /></Panel>}
    </div>
  );
}

export function StaffActivity({ user, onOpen }) {
  const taxonomy = useResource("/taxonomy");
  const defaultDepartment = user.department || "Biochemistry & Haematology Lab";
  const [department, setDepartment] = useState(defaultDepartment);
  const