import { useEffect, useState } from "react";
import {
  CalendarDays,
  MapPin,
  QrCode,
  ScanLine,
  Upload,
  ArrowRight,
} from "lucide-react";
import { request, useResource, dateTime } from "./client";
import { Action, Empty, Error, Load, Panel, Status } from "./UI";
import UploadForm from "../components/UploadForm";
import Records from "../apps/doctor/Records";

export function RecordsDesk({ pid, user, onOpen }) {
  const taxonomy = useResource("/taxonomy"),
    [version, setVersion] = useState(0);
  const [department, setDepartment] = useState(
    user.department || "Biochemistry & Haematology Lab",
  );
  const staffUpload = ["doctor", "nurse", "lab", "admin"].includes(user.role);
  return (
    <div className="stack">
      <Panel
        title="Original records"
        hint="Every explanation can be checked against the original document. Access is logged and files are watermarked."
      >
        <Load resource={taxonomy}>
          {(t) => (
            <Records
              key={`${pid}-${version}`}
              patientId={pid}
              taxonomy={t}
              onOpen={(tag) => onOpen(Number(tag.slice(1)))}
            />
          )}
        </Load>
      </Panel>
      {["patient", "caregiver", "doctor", "nurse", "lab", "admin"].includes(
        user.role,
      ) && (
        <>
          <Panel
            title="Upload to this patient's folder"
            hint="The printed patient identity is checked before filing. Unreadable identity needs an explicit manual verification."
          >
            <Load resource={taxonomy}>
              {(t) => (
                <div className="stack">
                  {staffUpload && <label className="field"><span>Filing department</span><select className="select" value={department} onChange={(e) => setDepartment(e.target.value)}>{t.departments.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}</select></label>}
                  <UploadForm
                    key={pid}
                    taxonomy={t}
                    mode={
                      ["patient", "caregiver"].includes(user.role)
                        ? "patient"
                        : "staff"
                    }
                    fixedPatientId={pid}
                    department={staffUpload ? department : "Patient"}
                    onUploaded={() => setVersion((v) => v + 1)}
                  />
                </div>
              )}
            </Load>
          </Panel>
        </>
      )}
      {["doctor", "nurse", "lab", "admin"].includes(user.role) && (
        <BulkImport pid={pid} taxonomy={taxonomy.data} />
      )}
    </div>
  );
}

function BulkImport({ pid, taxonomy }) {
  const [file, setFile] = useState(null),
    [bundle, setBundle] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState(null);
  const setPage = (index, key, value) =>
    setBundle((b) => ({
      ...b,
      pages: b.pages.map((p, i) => (i === index ? { ...p, [key]: value } : p)),
    }));
  return (
    <Panel
      title="Whole-file intake"
      hint="Up to 100 pages. OCR suggests filing tags per page; staff review, group and confirm every page before documents are filed."
    >
      <form
        className="row wrap"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          setBusy(true);
          try {
            const f = new FormData();
            f.append("file", file);
            const b = await request(
              `/v2/patients/${pid}/bulk-import`,
              "POST",
              f,
            );
            setBundle({
              ...b,
              pages: b.pages.map((p) => ({
                ...p,
                identity_confirmed: false,
                identity_reason: "",
              })),
            });
            setResult(null);
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <input
          type="file"
          accept="application/pdf"
          required
          onChange={(e) => setFile(e.target.files[0])}
        />
        <button className="btn" disabled={busy}>
          {busy ? "Reading every page…" : "Read bundle for review"}
        </button>
      </form>
      <Error message={error} />
      {bundle && !result && (
        <div className="stack">
          {bundle.pages.map((p, i) => (
            <details key={i} className="care-record">
              <summary>
                Page {p.page + 1} · {p.category} · {p.date || "date needed"}
              </summary>
              <pre className="care-pre small">
                {p.text || "No OCR text; read the original bundle."}
              </pre>
              <div className="grid2">
                <label className="field">
                  Group number
                  <input
                    className="input"
                    type="number"
                    min="1"
                    value={p.group}
                    onChange={(e) =>
                      setPage(i, "group", Number(e.target.value))
                    }
                  />
                </label>
                <label className="field">
                  Date
                  <input
                    className="input"
                    type="date"
                    value={p.date}
                    onChange={(e) => setPage(i, "date", e.target.value)}
                  />
                </label>
                <label className="field">
                  Category
                  <select
                    className="select"
                    value={p.category}
                    onChange={(e) => {
                      setPage(i, "category", e.target.value);
                      setPage(
                        i,
                        "subtype",
                        taxonomy.categories[e.target.value].subtypes[0],
                      );
                    }}
                  >
                    {Object.keys(taxonomy?.categories || {}).map((k) => (
                      <option key={k}>{k}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Subtype
                  <select
                    className="select"
                    value={p.subtype}
                    onChange={(e) => setPage(i, "subtype", e.target.value)}
                  >
                    {taxonomy?.categories[p.category]?.subtypes.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="field">
                Document title
                <input
                  className="input"
                  value={p.title}
                  onChange={(e) => setPage(i, "title", e.target.value)}
                />
              </label>
              <label className="care-check">
                <input
                  type="checkbox"
                  checked={p.identity_confirmed}
                  onChange={(e) =>
                    setPage(i, "identity_confirmed", e.target.checked)
                  }
                />
                I manually verified identity if the printed identity was
                unreadable
              </label>
              <input
                className="input"
                placeholder="How identity was verified (required when OCR cannot identify patient)"
                value={p.identity_reason}
                onChange={(e) => setPage(i, "identity_reason", e.target.value)}
              />
              <label className="care-check">
                <input
                  type="checkbox"
                  checked={p.confirmed}
                  onChange={(e) => setPage(i, "confirmed", e.target.checked)}
                />
                I checked this page's identity, date, type and document group
              </label>
            </details>
          ))}
          <Action
            className="btn primary"
            run={() =>
              request(`/v2/bulk-import/${bundle.id}/confirm`, "POST", {
                pages: bundle.pages.map(
                  ({
                    page,
                    group,
                    category,
                    subtype,
                    date,
                    title,
                    confirmed,
                    identity_confirmed,
                    identity_reason,
                  }) => ({
                    page,
                    group,
                    category,
                    subtype,
                    date,
                    title,
                    confirmed,
                    identity_confirmed,
                    identity_reason,
                  }),
                ),
              })
            }
            onDone={setResult}
          >
            Confirm & file all groups
          </Action>
        </div>
      )}
      {result && (
        <p className="care-success">
          Filed documents: {result.documents.map((x) => `D${x}`).join(", ")}
        </p>
      )}
    </Panel>
  );
}

export function DayPass({ pid, user }) {
  const [day, setDay] = useState(new Date().toLocaleDateString("en-CA"));
  const resource = useResource(
    `/v2/patients/${pid}/day-pass?day=${day}`,
    15000,
  );
  const taxonomy = useResource("/taxonomy"),
    [dept, setDept] = useState("Medical Oncology OPD"),
    [start, setStart] = useState(""),
    [error, setError] = useState("");
  return (
    <div className="care-columns">
      <Panel
        title="Hospital day pass"
        hint="One itinerary for your tests and visits. Wait times are estimates from the current queue."
      >
        <input
          className="input"
          type="date"
          aria-label="Hospital day"
          value={day}
          onChange={(e) => setDay(e.target.value)}
        />
        <Load resource={resource}>
          {(d) => (
            <>
              <div className="care-pass">
                <div className="row">
                  <span className="eyebrow">ONCOBRIEF · DAY PASS</span>
                  <span className="spacer" />
                  <QrCode />
                </div>
                <h2>{pid}</h2>
                <p>{d.date}</p>
                <img
                  src={`/api/v2/patients/${pid}/gate-qr`}
                  alt="Hospital gate check-in QR"
                  style={{ width: 120, height: 120 }}
                />
                <Action
                  run={() => request(`/v2/patients/${pid}/gate`, "POST")}
                  onDone={resource.refresh}
                >
                  Check in at hospital gate
                </Action>
                <div className="care-stops">
                  {d.stops.map((s, i) => (
                    <article key={s.id}>
                      <span className="care-step">{i + 1}</span>
                      <div>
                        <b>{s.department}</b>
                        <p>
                          {s.room} · {dateTime(s.start)}
                        </p>
                        <Status value={s.status} />
                        <p>
                          {s.ahead} ahead · about {s.wait_minutes} min
                        </p>
                        <p className="small muted">{s.directions}</p>
                        <div className="row wrap">
                          {(user.role === "patient" || user.role === "caregiver"
                            ? ["arrived"]
                            : ["arrived", "in_progress", "completed", "missed"]
                          ).map((action) => (
                            <Action
                              key={action}
                              run={() =>
                                request(
                                  `/v2/appointments/${s.id}/status`,
                                  "POST",
                                  { action },
                                )
                              }
                              onDone={resource.refresh}
                            >
                              {action.replaceAll("_", " ")}
                            </Action>
                          ))}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
                {!d.stops.length && <p>No bookings on this date.</p>}
              </div>
              {d.stays_url ? (
                <a
                  className="btn"
                  href={d.stays_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MapPin size={16} />
                  Find nearby patient accommodation
                </a>
              ) : (
                <p className="small muted">
                  Set the hospital address to enable nearby stays.
                </p>
              )}
              <button className="btn" onClick={() => window.print()}>
                Print day pass
              </button>
            </>
          )}
        </Load>
      </Panel>
      <Panel
        title="Plan one trip"
        hint="Choose the same date for tests and review. The scheduler checks room and patient clashes."
      >
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            try {
              await request("/appointments", "POST", {
                patient_id: pid,
                department: dept,
                start,
                visit_type: "follow_up",
              });
              resource.refresh();
            } catch (e) {
              setError(e.message);
            }
          }}
        >
          <label className="field">
            Department
            <select
              className="select"
              value={dept}
              onChange={(e) => setDept(e.target.value)}
            >
              {taxonomy.data?.departments.map((d) => (
                <option key={d.name}>{d.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Date and time
            <input
              type="datetime-local"
              className="input"
              required
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <button className="btn primary">Book appointment</button>
          <Error message={error} />
        </form>
        <p className="small muted">
          For a video visit, use a configured telemedicine service in Connected
          services.
        </p>
      </Panel>
    </div>
  );
}

export function ScheduleDesk({ user }) {
  const [day, setDay] = useState(new Date().toLocaleDateString("en-CA")),
    resource = useResource(`/schedule?day=${day}`, 15000);
  const [suggestions, setSuggestions] = useState({});
  return (
    <div className="stack">
      <PackedSchedule day={day} user={user} onDone={resource.refresh} />
      <Panel
        title="Hospital command & smart slot packing"
        hint="Review proposed changes before applying. Patient and room overlap are checked again when saving."
      >
        <input
          className="input"
          aria-label="Schedule date"
          type="date"
          value={day}
          onChange={(e) => setDay(e.target.value)}
        />
        <Load resource={resource}>
          {(d) => (
            <>
              <div className="care-metrics">
                <div>
                  <b>{d.appointments.length}</b>
                  <span>bookings</span>
                </div>
                <div>
                  <b>{d.clashes.length}</b>
                  <span>clashes to review</span>
                </div>
                <div>
                  <b>
                    {
                      d.appointments.filter((a) => a.status === "arrived")
                        .length
                    }
                  </b>
                  <span>arrived</span>
                </div>
              </div>
              {d.clashes.map((c, i) => (
                <p className="care-notice" key={i}>
                  {c.text}
                </p>
              ))}
              <ScheduleTimeline
                appointments={d.appointments}
                departments={d.departments}
                clashes={d.clashes}
              />
              <div className="care-scroll">
                <table className="list">
                  <thead>
                    <tr>
                      <th>Patient</th>
                      <th>Department / room</th>
                      <th>Time</th>
                      <th>Queue</th>
                      <th>Clash fix / packing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.appointments.map((a) => (
                      <tr key={a.id}>
                        <td>
                          {a.patient_name}
                          <br />
                          <small>{a.patient_id}</small>
                        </td>
                        <td>
                          {a.department}
                          <br />
                          {a.room}
                        </td>
                        <td className="small">{dateTime(a.start)}</td>
                        <td>
                          <Status value={a.status} />
                        </td>
                        <td>
                          <Action
                            run={() =>
                              request(`/v2/appointments/${a.id}/suggest-slot`)
                            }
                            onDone={(s) =>
                              setSuggestions((v) => ({ ...v, [a.id]: s }))
                            }
                          >
                            Suggest nearest free slot
                          </Action>
                          {suggestions[a.id] && (
                            <div className="stack">
                              <span className="small">
                                {dateTime(suggestions[a.id].start)}
                              </span>
                              <Action
                                run={() =>
                                  request(
                                    `/v2/appointments/${a.id}/reschedule`,
                                    "POST",
                                    { start: suggestions[a.id].start },
                                  )
                                }
                                onDone={() => {
                                  resource.refresh();
                                  setSuggestions((v) => ({
                                    ...v,
                                    [a.id]: null,
                                  }));
                                }}
                              >
                                Approve move
                              </Action>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Load>
      </Panel>
      {["frontdesk", "admin"].includes(user.role) && <PatientRegistration />}
    </div>
  );
}

function ScheduleTimeline({ appointments, departments, clashes }) {
  const conflicted = new Set(clashes.flatMap((c) => c.ids));
  const hours = Array.from({ length: 10 }, (_, i) => 8 + i);
  const point = (value) => {
    const d = new Date(value);
    return ((d.getHours() + d.getMinutes() / 60 - 8) / 9) * 100;
  };
  return (
    <Panel title="All departments, one day" hint="Conflicts use the same patient and room checks as the booking table below.">
      <div className="care-schedule-scroll">
        <div className="care-schedule-board">
          <div className="care-schedule-hours"><span>Department</span><div>{hours.map((h) => <span key={h}>{String(h).padStart(2, "0")}:00</span>)}</div></div>
          {departments.filter((name) => name !== "Front desk / Records").map((department) => {
            const rows = appointments.filter((a) => a.department === department);
            return <div className="care-schedule-row" key={department}><div className="care-schedule-dept">{department}<small>{rows.length} booked</small></div><div className="care-schedule-lane">{hours.slice(0, -1).map((hour) => <i key={hour} />)}{rows.map((a) => { const rawLeft = point(a.start); const left = Math.max(0, rawLeft); const width = Math.min(Math.max(point(a.end) - rawLeft, 2.4), 100 - left); return <div key={a.id} className={`care-schedule-slot ${conflicted.has(a.id) ? "clash" : ""}`} style={{ left: `${left}%`, width: `${width}%` }} title={`${new Date(a.start).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}–${new Date(a.end).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} · ${a.patient_name} (${a.patient_id}) · ${a.room}`}><b>{a.patient_name.split(" ")[0]}</b><small>{new Date(a.start).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} · {a.room}</small></div>; })}</div></div>;
          })}
        </div>
      </div>
      <p className="small muted" style={{ marginTop: 12 }}>The shared timeline helps teams spot when a patient has overlapping visits or a room is double-booked.</p>
    </Panel>
  );
}

export function ShareTools({ pid }) {
  const resource = useResource(`/v2/patients/${pid}/shares`);
  const [kind, setKind] = useState("emergency"),
    [fields, setFields] = useState([
      "regimen",
      "allergies",
      "counts",
      "contact",
    ]),
    [hours, setHours] = useState(24),
    [consent, setConsent] = useState(false),
    [recipient, setRecipient] = useState(""),
    [result, setResult] = useState(null);
  return (
    <div className="care-columns">
      <Panel
        title="Emergency QR & second-opinion pack"
        hint="Choose what to share for each link. Anyone holding the link can see those fields until expiry or withdrawal."
      >
        <div className="stack">
          <label className="field">
            Share type
            <select
              className="select"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setFields(
                  e.target.value === "emergency"
                    ? ["regimen", "allergies", "counts", "contact"]
                    : ["summary", "documents"],
                );
              }}
            >
              <option value="emergency">Emergency QR card</option>
              <option value="second_opinion">
                Second opinion (up to 7 days)
              </option>
            </select>
          </label>
          <div className="care-scopes">
            {(kind === "emergency"
              ? ["regimen", "allergies", "counts", "contact"]
              : [
                  "regimen",
                  "allergies",
                  "counts",
                  "contact",
                  "summary",
                  "documents",
                ]
            ).map((f) => (
              <label className="care-check" key={f}>
                <input
                  type="checkbox"
                  checked={fields.includes(f)}
                  onChange={(e) =>
                    setFields(
                      e.target.checked
                        ? [...fields, f]
                        : fields.filter((x) => x !== f),
                    )
                  }
                />
                {f}
              </label>
            ))}
          </div>
          <label className="field">
            Recipient / hospital
            <input
              className="input"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
            />
          </label>
          <label className="field">
            Expires in hours
            <input
              className="input"
              type="number"
              min="1"
              max="168"
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
            />
          </label>
          <label className="care-check">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            I consent to sharing these fields through this expiring link.
          </label>
          <Action
            className="btn primary"
            run={() =>
              request(`/v2/patients/${pid}/shares`, "POST", {
                kind,
                fields,
                hours,
                consent,
                recipient,
              })
            }
            onDone={(r) => {
              setResult(r);
              resource.refresh();
            }}
          >
            Create consent link
          </Action>
          {result && (
            <div className="care-share-card">
              <h3>
                {pid} · {kind.replaceAll("_", " ")}
              </h3>
              {result.qr_png && (
                <img src={result.qr_png} alt="QR for consented medical card" />
              )}
              <a href={result.url} target="_blank" rel="noreferrer">
                Open shared medical card
              </a>
              <p>Expires {dateTime(result.expires_at)}</p>
              <button className="btn" onClick={() => window.print()}>
                Print wallet card / save with phone screenshot
              </button>
            </div>
          )}
        </div>
      </Panel>
      <Panel title="Active and previous shares">
        <Load resource={resource}>
          {(items) =>
            items.length ? (
              items.map((s) => (
                <article className="care-record" key={s.id}>
                  <b>{s.kind.replaceAll("_", " ")}</b>
                  <p>{s.fields.join(", ")}</p>
                  <p>
                    Expires {dateTime(s.expires_at)} · {s.recipient}
                  </p>
                  {s.revoked ? (
                    <Status value="revoked" />
                  ) : (
                    <Action
                      run={() => request(`/v2/shares/${s.id}`, "DELETE")}
                      onDone={resource.refresh}
                    >
                      Withdraw link
                    </Action>
                  )}
                </article>
              ))
            ) : (
              <Empty>No consent links created.</Empty>
            )
          }
        </Load>
        <a
          className="btn"
          href={`/api/v2/patients/${pid}/pack.pdf`}
          target="_blank"
          rel="noreferrer"
        >
          Download my case pack PDF
        </a>
      </Panel>
    </div>
  );
}

export function MoneyNavigator({ pid, patient }) {
  const resource = useResource(`/v2/patients/${pid}/records?kind=finance`);
  return (
    <Panel
      title="Money & scheme navigator"
      hint="A checklist to discuss with the hospital's Ayushman Mitra. Scheme eligibility and claims are confirmed by the scheme, not the app."
    >
      <div className="care-notice">
        {patient?.age >= 70
          ? "Age 70 or above: ask about the PM-JAY senior-citizen pathway."
          : "Ask the Ayushman Mitra to check your household and state eligibility."}{" "}
        Benefits, hospital participation and treatment packages need official
        verification.
      </div>
      <p>
        Bring identity and address proof, any existing Ayushman card, referral
        and treatment estimate. Ask which documents your state requires.
      </p>
      <a
        className="btn"
        href="https://beneficiary.nha.gov.in/"
        target="_blank"
        rel="noreferrer"
      >
        Official PM-JAY eligibility portal
      </a>
      <a
        className="btn"
        href="https://nha.gov.in/PM-JAY"
        target="_blank"
        rel="noreferrer"
      >
        Official scheme information
      </a>
      <Load resource={resource}>
        {(rows) =>
          rows.map((r) => (
            <article className="care-record" key={r.id}>
              <h3>{r.data.state}</h3>
              <p>
                Quoted treatment: ₹
                {(r.data.estimate || 0).toLocaleString("en-IN")} · confirmed
                cover: ₹{(r.data.confirmed_cover || 0).toLocaleString("en-IN")}
              </p>
              <p>
                <b>
                  Estimated uncovered amount: ₹
                  {Math.max(
                    0,
                    (r.data.estimate || 0) - (r.data.confirmed_cover || 0),
                  ).toLocaleString("en-IN")}
                </b>
              </p>
              <p className="small muted">
                Based only on entered quote and confirmed coverage; excludes
                unquoted expenses.
              </p>
              <p>{r.data.text}</p>
            </article>
          ))
        }
      </Load>
      <p>
        Add state, a hospital quote and confirmed coverage using the Money &
        scheme workflow in Plans & journal.
      </p>
    </Panel>
  );
}

function PatientRegistration() {
  const [v, setV] = useState({
      name: "",
      age: "",
      sex: "F",
      phone: "",
      preferred_language: "en",
      cancer_type: "",
      abha_id: "",
      referred_from: "",
    }),
    [result, setResult] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Panel
      title="Register a new patient"
      hint="Creates the folder and identity card. The administrator then assigns the treating doctor, ward nurse and patient's own account."
    >
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const p = await request("/patients", "POST", {
              ...v,
              age: Number(v.age),
              abha_id: v.abha_id || null,
            });
            setResult(p);
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="grid2">
          {[
            ["name", "Full name"],
            ["age", "Age"],
            ["phone", "Phone"],
            ["cancer_type", "Reason for referral"],
            ["abha_id", "ABHA (optional)"],
            ["referred_from", "Referred by (optional)"],
          ].map(([key, label]) => (
            <label className="field" key={key}>
              {label}
              <input
                className="input"
                type={key === "age" ? "number" : "text"}
                required={["name", "age"].includes(key)}
                min="0"
                max="120"
                value={v[key]}
                onChange={(e) => setV({ ...v, [key]: e.target.value })}
              />
            </label>
          ))}
          <label className="field">
            Sex
            <select
              className="select"
              value={v.sex}
              onChange={(e) => setV({ ...v, sex: e.target.value })}
            >
              <option value="F">Female</option>
              <option value="M">Male</option>
              <option value="O">Other</option>
            </select>
          </label>
          <label className="field">
            Preferred language
            <select
              className="select"
              value={v.preferred_language}
              onChange={(e) =>
                setV({ ...v, preferred_language: e.target.value })
              }
            >
              <option value="en">English</option>
              <option value="hi">हिंदी</option>
              <option value="mr">मराठी</option>
            </select>
          </label>
        </div>
        <button className="btn primary" disabled={busy}>
          Create patient folder
        </button>
        <Error message={error} />
      </form>
      {result && (
        <div className="care-share-card">
          <h3>
            {result.name} · {result.id}
          </h3>
          <img
            src={`/api/patients/${result.id}/qr`}
            alt="Patient identity QR"
          />
          <button className="btn" onClick={() => window.print()}>
            Print identity card
          </button>
        </div>
      )}
    </Panel>
  );
}

function PackedSchedule({ day, user, onDone }) {
  const [plan, setPlan] = useState(null),
    [applied, setApplied] = useState(false);
  useEffect(() => {
    setPlan(null);
    setApplied(false);
  }, [day]);
  return (
    <Panel
      title="Pack a day into fewer gaps"
      hint="Preview a room-and-patient schedule that groups each patient's visits. Staff check preparation and clinical constraints before approval."
    >
      <Action
        run={() => request(`/v2/schedule/packing?day=${day}`)}
        onDone={setPlan}
      >
        Preview packed schedule
      </Action>
      {plan && (
        <div className="stack">
          <p>
            Recorded between-visit gaps: {plan.waiting_before} →{" "}
            {plan.waiting_after} minutes across the selected patients.
          </p>
          <p className="small muted">{plan.review}</p>
          {plan.changes.map((c) => (
            <p className="small" key={c.id}>
              {c.patient_id} · {c.department} / {c.room}:{" "}
              {dateTime(c.expected_start)} → {dateTime(c.start)}
            </p>
          ))}
          {plan.changes.length > 0 &&
            ["frontdesk", "nurse", "admin"].includes(user.role) && (
              <Action
                className="btn primary"
                run={() =>
                  request("/v2/schedule/packing", "POST", {
                    changes: plan.changes.map(
                      ({ id, expected_start, start, end }) => ({
                        id,
                        expected_start,
                        start,
                        end,
                      }),
                    ),
                    approved: true,
                  })
                }
                onDone={() => {
                  setApplied(true);
                  onDone();
                }}
              >
                Staff: approve and apply this plan
              </Action>
            )}
          {applied && (
            <p className="care-success">
              Schedule updated. Patient day passes use the new times.
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}
