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
import { hospitalDateTime, request, useResource } from "./client";
import MemoryUpLink from "./MemoryUpLink";

const VISITS = [
  ["new", "New patient", "Referral, pathology and what is missing"],
  ["follow_up", "Follow-up", "What changed since the last visit"],
  ["transfer", "Hospital transfer", "History from another hospital"],
];

export function ClinicDesk({ patients = [], pid, onSelect, onOpen, onRecords }) {
  const calendar = useResource("/taxonomy");
  const day = calendar.data?.hospital_today || "";
  const queue = useResource(
    `/appointments?${day ? `day=${day}&` : ""}department=${encodeURIComponent("Medical Oncology OPD")}`,
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
          action={<span className="care-inline-meta"><CalendarDays size={15} /> {day ? hospitalDateTime(day) : "Hospital date"}</span>}
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
                    <span className="care-clinic-time"><Clock3 size={15} />{String(a.start).slice(11, 16)}</span>
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
                {selectedAppointment && <p className="small muted">Scheduled {hospitalDateTime(selectedAppointment.start)} · {selectedAppointment.department} · {selectedAppointment.room}</p>}
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

      <MemoryUpLink pid={pid} appointmentId={selectedAppointment?.id} />

      {activePatient && <DeterministicClinicalPanel patient={activePatient} />}

      {brief && <Panel title="Visit brief" hint="Each item includes a source link where the record supports it." action={<span className="care-inline-meta"><CheckCircle2 size={15} /> Ready for review</span>}><Brief data={brief} onOpen={onOpen} /></Panel>}
    </div>
  );
}

function DeterministicClinicalPanel({ patient }) {
  const [site, setSite] = useState(/lung|nsclc/i.test(patient.cancer_type || "") ? "lung" : "breast");
  const [tnm, setTnm] = useState({ t: "TX", n: "NX", m: "MX" });
  const [stage, setStage] = useState(null);
  const [stageError, setStageError] = useState("");
  const [values, setValues] = useState({
    age_years: patient.age ?? "", weight_kg: "", height_cm: "", serum_creatinine_mg_dl: "",
    is_female: /^(f|female)/i.test(patient.sex || ""), regimen: "",
    anc_per_ul: "", lvef_percent: "", platelets_per_ul: "", bilirubin_mg_dl: "",
  });
  const [dosing, setDosing] = useState(null);
  const [dosingError, setDosingError] = useState("");
  const [dosingBusy, setDosingBusy] = useState(false);
  useEffect(() => {
    setSite(/lung|nsclc/i.test(patient.cancer_type || "") ? "lung" : "breast");
    setTnm({ t: "TX", n: "NX", m: "MX" });
    setStage(null);
    setValues((old) => ({ ...old, age_years: patient.age ?? "", is_female: /^(f|female)/i.test(patient.sex || "") }));
    setDosing(null);
  }, [patient.id]);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => request("/clinical/stage", "POST", { site, ...tnm })
      .then((result) => { if (live) { setStage(result); setStageError(""); } })
      .catch((e) => { if (live) { setStage(null); setStageError(e.message); } }), 120);
    return () => { live = false; clearTimeout(timer); };
  }, [site, tnm]);
  useEffect(() => {
    const required = ["age_years", "weight_kg", "height_cm", "serum_creatinine_mg_dl"];
    if (required.some((key) => values[key] === "" || !Number.isFinite(Number(values[key])) || Number(values[key]) <= 0)) {
      setDosing(null);
      setDosingError("");
      setDosingBusy(false);
      return;
    }
    let live = true;
    setDosingBusy(true);
    const timer = setTimeout(() => {
      const numberOrNull = (value) => value === "" ? null : Number(value);
      request("/clinical/dosing", "POST", {
        age_years: Number(values.age_years), weight_kg: Number(values.weight_kg),
        height_cm: Number(values.height_cm), serum_creatinine_mg_dl: Number(values.serum_creatinine_mg_dl),
        is_female: values.is_female, regimen: values.regimen,
        anc_per_ul: numberOrNull(values.anc_per_ul), lvef_percent: numberOrNull(values.lvef_percent),
        platelets_per_ul: numberOrNull(values.platelets_per_ul), bilirubin_mg_dl: numberOrNull(values.bilirubin_mg_dl),
      }).then((result) => { if (live) { setDosing(result); setDosingError(""); } })
        .catch((e) => { if (live) { setDosing(null); setDosingError(e.message); } })
        .finally(() => { if (live) setDosingBusy(false); });
    }, 180);
    return () => { live = false; clearTimeout(timer); };
  }, [values]);

  const tOptions = site === "breast"
    ? ["TX", "T0", "Tis", "T1", "T1mi", "T1a", "T1b", "T1c", "T2", "T3", "T4", "T4a", "T4b", "T4c", "T4d"]
    : ["TX", "Tis", "T1mi", "T1a", "T1b", "T1c", "T2a", "T2b", "T2", "T3", "T4"];
  const nOptions = site === "breast"
    ? ["NX", "N0", "N1mi", "N1", "N1a", "N1b", "N1c", "N2", "N2a", "N2b", "N3", "N3a", "N3b", "N3c"]
    : ["NX", "N0", "N1", "N2", "N3"];
  const mOptions = site === "breast" ? ["MX", "M0", "M0(i+)", "M1"] : ["MX", "M0", "M1a", "M1b", "M1c", "M1"];
  const update = (key, value) => setValues((old) => ({ ...old, [key]: value }));
  const field = (key, label, min, max, step = "any") => <label className="field" key={key}>{label}
    <input className="input" type="number" min={min} max={max} step={step} value={values[key]} onChange={(event) => update(key, event.target.value)} />
  </label>;
  const metricCards = dosing?.metrics ? [
    { name: "BSA", value: `${dosing.metrics.bsa_m2} m²` },
    { name: "CrCl", value: `${dosing.metrics.crcl_ml_min} mL/min` },
    { name: "Carboplatin AUC 5", value: `${dosing.metrics.carboplatin_auc5_mg} mg` },
    { name: "Carboplatin AUC 6", value: `${dosing.metrics.carboplatin_auc6_mg} mg` },
  ] : [];

  return <section className="care-clinical-tools">
    <Panel title="Deterministic staging" hint="AJCC 8 anatomical stage grouping from clinician-selected source TNM. It does not infer TNM from the report.">
      <div className="grid2">
        <label className="field">Primary site<select className="select" value={site} onChange={(e) => { setSite(e.target.value); setTnm({ t: "TX", n: "NX", m: "MX" }); }}><option value="breast">Breast</option><option value="lung">NSCLC / lung</option></select></label>
        {[['t','T'],['n','N'],['m','M']].map(([key,label]) => <label className="field" key={key}>{label} category<select className="select" value={tnm[key]} onChange={(e) => setTnm((old) => ({ ...old, [key]: e.target.value }))}>{(key === 't' ? tOptions : key === 'n' ? nOptions : mOptions).map((option) => <option key={option}>{option}</option>)}</select></label>)}
      </div>
      <div className="care-success" style={{ marginTop: 14, padding: 16, background: "#e8f5ed", color: "#17633e" }} aria-live="polite"><b>Deterministic Staging</b><div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{stage?.stage || "Calculating…"}</div></div>
      {stageError && <p className="care-error" role="alert">Staging calculation unavailable: {stageError}</p>}
      {stage?.basis && <p className="small muted">{stage.basis}</p>}
    </Panel>
    <Panel title="Dosing metrics & organ-safety screen" hint="Enter verified measurements. Estimates are calculated by fixed formulas; confirm the regimen-specific protocol before treatment.">
      <div className="grid2">
        {field("age_years", "Age (years)", 18, 120, "1")}
        {field("weight_kg", "Dosing weight (kg)", 1, 400, "0.1")}
        {field("height_cm", "Height (cm)", 1, 250, "0.1")}
        {field("serum_creatinine_mg_dl", "Serum creatinine (mg/dL)", 0.1, 50, "0.01")}
        <label className="field">Cockcroft–Gault 0.85 factor<select className="select" value={values.is_female ? "yes" : "no"} onChange={(e) => update("is_female", e.target.value === "yes")}><option value="yes">Apply 0.85 factor</option><option value="no">Do not apply 0.85 factor</option></select></label>
        <label className="field">Selected regimen<select className="select" value={values.regimen} onChange={(e) => update("regimen", e.target.value)}><option value="">Select regimen</option><option value="cisplatin">Cisplatin</option><option value="AC">AC (doxorubicin + cyclophosphamide)</option><option value="epirubicin">Epirubicin</option><option value="paclitaxel">Paclitaxel</option><option value="docetaxel">Docetaxel</option><option value="other">Other / not listed</option></select></label>
        {field("anc_per_ul", "ANC (/µL)", 0, 200000, "1")}
        {field("lvef_percent", "LVEF (%)", 0, 100, "0.1")}
        {field("platelets_per_ul", "Platelets (/µL)", 0, 2000000, "1")}
        {field("bilirubin_mg_dl", "Total bilirubin (mg/dL)", 0, 100, "0.01")}
      </div>
      {dosingBusy && <p className="small muted">Recalculating…</p>}
      {dosing?.metrics && <div className="grid2" style={{ marginTop: 14 }}>
        {metricCards.map(({ name, value }) => <div className="care-notice info" key={name}><small>{name}</small><div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div></div>)}
      </div>}
      {dosing?.metrics?.gfr_capped && <p className="care-notice warning">Carboplatin calculation capped the GFR input at 125 mL/min.</p>}
      {dosing?.alerts?.map((alert, index) => <div className={alert.severity === "CRITICAL" ? "care-emergency" : "care-notice warning"} role={alert.severity === "CRITICAL" ? "alert" : "status"} key={`${alert.parameter}-${index}`}><b>{alert.severity}: {alert.parameter}</b><p>{alert.observation}</p><p>{alert.guideline_action}</p></div>)}
      {dosingError && <p className="care-error" role="alert">Calculation unavailable: {dosingError}</p>}
      <p className="small muted">CrCl is used as the Calvert GFR input. Verify renal measure, weight selection, alerts, and dose with the current local protocol. This tool does not prescribe or place orders.</p>
    </Panel>
  </section>;
}

export function StaffActivity({ user, onOpen }) {
  const taxonomy = useResource("/taxonomy");
  const defaultDepartment = user.department || "Biochemistry & Haematology Lab";
  const [department, setDepartment] = useState(defaultDepartment);
  const uploads = useResource(`/documents/recent?department=${encodeURIComponent(department)}&limit=20`, 30000);
  const audit = useResource("/audit?limit=18", 30000);

  return (
    <div className="stack">
      <MemoryUpLink />
      <Panel title="Recent uploads" hint="Recent documents visible to your role. Open a row to review the original file." action={
        <label className="care-activity-department"><span>Department</span><select className="select" value={department} onChange={(e) => setDepartment(e.target.value)} aria-label="Filter uploads by department">{(taxonomy.data?.departments || []).map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}</select></label>
      }>
        <Error message={taxonomy.error} />
        <Load resource={uploads}>
          {(rows) => rows.length ? <div className="care-scroll"><table className="list care-activity-table"><thead><tr><th>Patient</th><th>Document</th><th>Report date</th><th>OCR</th></tr></thead><tbody>{rows.map((d) => <tr key={d.id}><td><b>{d.patient_name}</b><small>{d.patient_id}</small></td><td><button className="care-activity-open" onClick={() => onOpen(d.id)}><FileStack size={15} />{d.subtype || d.title || "Open record"}</button><small>{d.uploaded_by}</small></td><td>{new Date(d.record_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</td><td>{d.ocr_method === "pdf-text" ? "PDF text" : `${d.ocr_confidence ?? "—"}%`}</td></tr>)}</tbody></table></div> : <Empty>No uploads are visible for this department.</Empty>}
        </Load>
      </Panel>
      <Panel title="Access log" hint="A role-scoped history of who opened or changed a patient record.">
        <Load resource={audit}>
          {(rows) => rows.length ? <div className="care-activity-log">{rows.map((a, i) => <article key={`${a.at}-${i}`}><span className="care-activity-log-icon"><History size={15} /></span><div><b>{a.name}</b><small>{a.role} · {a.patient_id || "Workspace"} · {new Date(a.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</small></div><span className="care-activity-action">{a.action.replaceAll("_", " ")}</span></article>)}</div> : <Empty>No access events are visible to this account.</Empty>}
        </Load>
      </Panel>
      <p className="care-activity-note"><FileClock size={15} /> Activity and uploads are filtered by the account’s assigned access.</p>
    </div>
  );
}


