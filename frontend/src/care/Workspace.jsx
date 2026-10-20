import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Bell,
  BookHeart,
  CalendarDays,
  CircleHelp,
  ClipboardList,
  FileStack,
  Flower2,
  HeartHandshake,
  HeartPulse,
  Home,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  Pill,
  Settings2,
  ShieldCheck,
  Stethoscope,
  Users,
  X,
  QrCode,
} from "lucide-react";
import { useAuth, Login } from "./Auth";
import { request, useResource, dateTime, nice } from "./client";
import {
  Action,
  Empty,
  Error,
  Load,
  Panel,
  SourceLinks,
  Status,
  Voice,
} from "./UI";
import { CheckIn, Companion, Medicines, Wellness } from "./PatientTools";
import {
  AlertConsole,
  ApprovalQueue,
  ClinicalChart,
  SmartInbox,
} from "./ClinicalTools";
import {
  CareChat,
  CareCircle,
  Integrations,
  Journal,
  Privacy,
  VisitPrep,
} from "./TeamTools";
import {
  DayPass,
  MoneyNavigator,
  RecordsDesk,
  ScheduleDesk,
  ShareTools,
} from "./HospitalTools";
import DocViewer from "../components/DocViewer";
import QrScanner from "../components/QrScanner";
import Brief from "../apps/doctor/Brief";
import "./care.css";

const NAV = [
  ["home", "My care space", Home, "profile"],
  ["checkin", "Daily check-in", HeartPulse, "checkin"],
  ["companion", "Ask my records", MessageCircle, "documents"],
  ["medicines", "Medicines & requests", Pill, "medicines"],
  ["clinical", "Journey & response", Stethoscope, "documents"],
  ["journal", "Plans & journal", BookHeart, "notes"],
  ["chat", "Care circle chat", HeartHandshake, "chat"],
  ["day", "Hospital day pass", CalendarDays, "appointments"],
  ["wellness", "Food, energy & play", Flower2, "nutrition"],
  ["records", "Reports & uploads", FileStack, "documents"],
  ["money", "Money & schemes", CircleHelp, "finance"],
  ["circle", "Caregiver consent", Users, "patient"],
  ["share", "Emergency QR & sharing", ShieldCheck, "patient"],
  ["triage", "Nurse triage", HeartPulse, "clinician"],
  ["approvals", "Doctor approvals", ClipboardList, "doctor"],
  ["schedule", "Schedule & chairs", LayoutDashboard, "staff"],
  ["privacy", "Privacy & devices", ShieldCheck, "profile"],
  ["settings", "Connected services", Settings2, "profile"],
];

export default function Workspace() {
  const auth = useAuth();
  if (auth.loading)
    return <p className="care-loading">Opening your care space…</p>;
  return auth.user ? <CareSpace key={auth.user.id} /> : <Login />;
}

function CareSpace() {
  const { user, logout } = useAuth(),
    patients = useResource("/patients"),
    notes = useResource("/v2/notifications", 15000);
  const [pid, setPid] = useState(user.patient_ids[0] || ""),
    [tab, setTab] = useState("home"),
    [docId, setDocId] = useState(null),
    [language, setLanguage] = useState("en"),
    [menu, setMenu] = useState(false),
    [showNotifications, setShowNotifications] = useState(false),
    [revision, setRevision] = useState(0);
  const [qr, setQr] = useState(false),
    [qrError, setQrError] = useState("");
  const [focusedRecordId, setFocusedRecordId] = useState(null);
  useEffect(() => setFocusedRecordId(null), [pid]);
  useEffect(() => {
    const open = (e) => {
      setFocusedRecordId(Number(e.detail));
      setTab("journal");
      setMenu(false);
    };
    window.addEventListener("ob-open-record", open);
    return () => window.removeEventListener("ob-open-record", open);
  }, []);
  const gate = new URLSearchParams(window.location.search).get("gate");
  const patient = patients.data?.find((p) => p.id === pid);
  const can = (scope) => {
    if (scope === "patient") return user.role === "patient";
    if (scope === "doctor") return user.role === "doctor";
    if (scope === "clinician") return ["doctor", "nurse"].includes(user.role);
    if (scope === "staff")
      return ["doctor", "nurse", "frontdesk", "admin"].includes(user.role);
    const scopes = user.permissions?.[pid] || [];
    return (
      scopes.includes("all") || scopes.includes(scope) || scope === "profile"
    );
  };
  const roleTabs = {
    lab: ["home", "records", "privacy", "settings"],
    dietitian: [
      "home",
      "journal",
      "records",
      "wellness",
      "privacy",
      "settings",
    ],
    frontdesk: ["home", "day", "schedule", "privacy", "settings"],
    navigator: [
      "home",
      "journal",
      "chat",
      "day",
      "money",
      "privacy",
      "settings",
    ],
    privacy: ["home", "privacy", "settings"],
    admin: ["home", "schedule", "privacy", "settings"],
  };
  const nav = NAV.filter(
    (n) =>
      can(n[3]) && (!roleTabs[user.role] || roleTabs[user.role].includes(n[0])),
  );
  useEffect(() => {
    if (!nav.some((n) => n[0] === tab)) setTab("home");
  }, [pid]);
  useEffect(() => {
    if (patient?.preferred_language) setLanguage(patient.preferred_language);
  }, [patient?.id]);
  const change = (value) => {
    setTab(value);
    setMenu(false);
  };
  const unread = notes.data?.filter((n) => n.status === "unread").length || 0;
  const title = nav.find((n) => n[0] === tab)?.[1] || "My care space";
  return (
    <div className="care-app">
      <aside className={`care-sidebar ${menu ? "open" : ""}`}>
        <Link to="/" className="care-logo">
          <HeartPulse />
          OncoBrief<span>2</span>
        </Link>
        <div className="care-role">
          <span className="care-avatar">{user.name.slice(0, 1)}</span>
          <div>
            <b>{user.name}</b>
            <small>{nice(user.role)}</small>
          </div>
        </div>
        <p className="care-nav-label">CONNECTED CARE</p>
        <nav>
          {nav.map(([key, label, Icon]) => (
            <button
              key={key}
              className={tab === key ? "active" : ""}
              onClick={() => change(key)}
            >
              <Icon size={18} />
              {label}
              {key === "triage" && <span className="care-live-dot" />}
            </button>
          ))}
        </nav>
        <div className="care-sidebar-foot">
          <ShieldCheck size={17} />
          <span>
            AI suggests.
            <br />
            Your doctor decides.
          </span>
        </div>
      </aside>
      <div className="care-page">
        <header className="care-top">
          <button
            className="btn care-menu"
            aria-label="Toggle navigation"
            onClick={() => setMenu((v) => !v)}
          >
            <Menu size={20} />
          </button>
          <div className="care-breadcrumb">
            Care space <span>/</span> <b>{title}</b>
          </div>
          <div className="spacer" />
          <select
            className="select care-language"
            aria-label="Language"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          >
            <option value="en">English</option>
            <option value="hi">हिंदी</option>
            <option value="mr">मराठी</option>
          </select>
          <button
            className="btn care-bell"
            aria-label="Notifications"
            onClick={() => setShowNotifications((v) => !v)}
          >
            <Bell size={19} />
            {unread > 0 && <span>{unread}</span>}
          </button>
          <button className="btn" aria-label="Sign out" onClick={logout}>
            <LogOut size={16} />
            <span className="care-hide-mobile">Sign out</span>
          </button>
        </header>
        {user.demo && (
          <div className="care-demo-strip">
            DEMO ENVIRONMENT · Fabricated patients and reports · Use separate
            browser profiles to demonstrate multiple roles
          </div>
        )}
        <main className="care-main">
          <div className="care-page-heading">
            <div>
              <p className="eyebrow">
                {new Date().toLocaleDateString("en-IN", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}
              </p>
              <h1>{title}</h1>
              {["doctor", "nurse", "frontdesk", "lab"].includes(user.role) && (
                <button className="btn" onClick={() => setQr(true)}>
                  <QrCode size={16} />
                  Scan patient QR
                </button>
              )}
            </div>
            {patients.data?.length > 0 && (
              <label className="care-patient-select">
                <span>Patient folder</span>
                <select
                  className="select"
                  aria-label="Patient folder"
                  value={pid}
                  onChange={(e) => {
                    setPid(e.target.value);
                    setDocId(null);
                  }}
                >
                  {patients.data.map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.name} · {p.id}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <Error message={patients.error} />
          <Error message={qrError} />
          {gate && user.patient_ids.includes(gate) && (
            <Panel title="QR gate check-in">
              <p>
                Record your arrival so all booked departments can see you are
                here.
              </p>
              <Action
                run={() => request(`/v2/patients/${gate}/gate`, "POST")}
                onDone={() => {
                  setPid(gate);
                  change("day");
                }}
              >
                I am at the hospital: check in
              </Action>
            </Panel>
          )}
          {showNotifications && (
            <Panel
              title="Notifications"
              action={
                <button
                  className="btn"
                  aria-label="Close notifications"
                  onClick={() => setShowNotifications(false)}
                >
                  <X size={16} />
                </button>
              }
            >
              {notes.data?.length ? (
                notes.data.map((n) => (
                  <article className="care-record" key={n.id}>
                    <b>{n.title}</b>
                    <p>{n.body}</p>
                    <small className="muted">{dateTime(n.created_at)}</small>
                    {n.status === "unread" && (
                      <Action
                        run={() =>
                          request(`/v2/notifications/${n.id}/read`, "POST")
                        }
                        onDone={notes.refresh}
                      >
                        Mark read
                      </Action>
                    )}
                  </article>
                ))
              ) : (
                <Empty>No notifications.</Empty>
              )}
            </Panel>
          )}
          {!pid &&
          tab !== "settings" &&
          tab !== "privacy" &&
          tab !== "schedule" ? (
            <Panel title="No patient folders assigned">
              <p>
                A hospital administrator can create accounts and assign the
                appropriate patient relationships in Connected services.
              </p>
              {["frontdesk", "admin"].includes(user.role) && (
                <button className="btn" onClick={() => change("schedule")}>
                  Register a patient
                </button>
              )}
              <button
                className="btn primary"
                onClick={() => change("settings")}
              >
                Open account setup
              </button>
            </Panel>
          ) : (
            <div key={`${pid}-${tab}`}>
              {tab === "home" && (
                <HomeSpace
                  pid={pid}
                  patient={patient}
                  user={user}
                  can={can}
                  onTab={change}
                  onSelect={setPid}
                  onOpen={setDocId}
                  visibleTabs={nav.map((n) => n[0])}
                  revision={revision}
                />
              )}
              {tab === "checkin" && (
                <div className="care-columns">
                  <CheckIn
                    pid={pid}
                    language={language}
                    onUpdate={() => {
                      notes.refresh();
                      setRevision((v) => v + 1);
                    }}
                  />
                  <div className="stack">
                    {can("notes") && <VisitPrep pid={pid} />}
                    <CheckIn pid={pid} language={language} phoneDemo />
                  </div>
                </div>
              )}
              {tab === "companion" && (
                <Companion
                  pid={pid}
                  language={language}
                  clinician={user.role === "doctor"}
                  onOpen={setDocId}
                />
              )}
              {tab === "medicines" && (
                <Medicines
                  pid={pid}
                  user={user}
                  onUpdate={() => setRevision((v) => v + 1)}
                />
              )}
              {tab === "clinical" && (
                <ClinicalChart pid={pid} user={user} onOpen={setDocId} />
              )}
              {tab === "journal" && (
                <Journal
                  pid={pid}
                  user={user}
                  onOpen={setDocId}
                  focusedRecordId={focusedRecordId}
                  onClearFocus={() => setFocusedRecordId(null)}
                />
              )}
              {tab === "chat" && <CareChat pid={pid} />}
              {tab === "day" && <DayPass pid={pid} user={user} />}
              {tab === "wellness" && (
                <Wellness
                  pid={pid}
                  language={language}
                  canTeachBack={can("notes")}
                />
              )}
              {tab === "records" && (
                <RecordsDesk pid={pid} user={user} onOpen={setDocId} />
              )}
              {tab === "money" && (
                <MoneyNavigator pid={pid} patient={patient} />
              )}
              {tab === "circle" && <CareCircle pid={pid} />}
              {tab === "share" && <ShareTools pid={pid} />}
              {tab === "triage" && (
                <AlertConsole
                  onSelect={(id) => {
                    setPid(id);
                    change("clinical");
                  }}
                />
              )}
              {tab === "approvals" && <ApprovalQueue pid={pid} />}
              {tab === "schedule" && <ScheduleDesk user={user} />}
              {tab === "privacy" && <Privacy pid={pid} user={user} />}
              {tab === "settings" && (
                <Integrations pid={pid} user={user} language={language} />
              )}
            </div>
          )}
          <footer className="care-footer">
            OncoBrief · Team TripleT{" "}
            <span>
              Clinical changes require the treating doctor's signature.
            </span>
          </footer>
        </main>
      </div>
      {qr && (
        <QrScanner
          onClose={() => setQr(false)}
          onResult={(id) => {
            setQr(false);
            if (user.patient_ids.includes(id)) {
              setPid(id);
              setQrError("");
            } else
              setQrError(
                "This QR does not belong to a patient assigned to your account.",
              );
          }}
        />
      )}
      {docId && <DocViewer docId={docId} onClose={() => setDocId(null)} />}
    </div>
  );
}

function HomeSpace({
  pid,
  patient,
  user,
  can,
  onTab,
  onSelect,
  onOpen,
  visibleTabs = [],
}) {
  const clinician = [
    "doctor",
    "nurse",
    "navigator",
    "frontdesk",
    "admin",
  ].includes(user.role);
  const command = useResource(clinician ? "/v2/command-centre" : null, 15000);
  const week = useResource(can("activity") ? `/v2/patients/${pid}/week` : null);
  const day = useResource(
    can("appointments") ? `/v2/patients/${pid}/day-pass` : null,
  );
  const meds = useResource(
    can("medicines") ? `/patients/${pid}/medications` : null,
  );
  const [brief, setBrief] = useState(null);
  const [commandAnswer, setCommandAnswer] = useState(null);
  const voiceCommand = async (text) => {
    try {
      if (/brief/i.test(text)) {
        setBrief(
          await request("/brief", "POST", {
            patient_id: pid,
            visit_type: "follow_up",
          }),
        );
      } else if (/cbc|blood count|सीबीसी/i.test(text)) {
        const docs = await request(`/patients/${pid}/documents?q=CBC`);
        setCommandAnswer({
          answer: "The latest matching CBC records:",
          sources: docs
            .sort((a, b) => b.record_date.localeCompare(a.record_date))
            .slice(0, 3)
            .map((d) => ({ id: d.id, tag: d.tag, title: d.title })),
        });
      } else {
        setCommandAnswer(
          await request(`/v2/patients/${pid}/companion`, "POST", {
            text,
            language: "en",
          }),
        );
      }
    } catch (e) {
      setCommandAnswer({ answer: e.message, sources: [] });
    }
  };
  return (
    <div className="stack">
      <section className="care-welcome">
        <div>
          <span className="care-pill">
            {clinician ? "BETWEEN-VISIT COMMAND CENTRE" : "ONE DAY AT A TIME"}
          </span>
          <h2>
            {clinician
              ? `Welcome, ${user.name}.`
              : `Hello, ${patient?.name?.split(" ")[0] || user.name.split(" ")[0]}.`}
            <br />
            {clinician
              ? "See who needs your attention."
              : "Let’s make today a little clearer."}
          </h2>
          <p>
            {clinician
              ? "Home check-ins, recent changes and pending decisions in one connected care space."
              : "Your check-in helps the team hear about changes between visits. Even the small things count."}
          </p>
          <div className="row wrap">
            {can("checkin") && (
              <button
                className="btn care-white"
                onClick={() => onTab("checkin")}
              >
                Start daily check-in <HeartPulse size={17} />
              </button>
            )}
            {can("appointments") && (
              <button
                className="btn care-outline-white"
                onClick={() => onTab("day")}
              >
                See my day pass
              </button>
            )}
          </div>
        </div>
        <div className="care-welcome-art" aria-hidden="true">
          <HeartPulse size={92} />
          <span>
            Always part of
            <br />
            your care story.
          </span>
        </div>
      </section>
      <div className="care-summary-grid">
        <button
          className="care-stat"
          onClick={() => onTab("medicines")}
          disabled={!can("medicines")}
        >
          <Pill />
          <b>{meds.data?.length ?? "—"}</b>
          <span>active medicines</span>
          <small>Signed prescriptions</small>
        </button>
        <button
          className="care-stat"
          onClick={() => onTab("day")}
          disabled={!can("appointments")}
        >
          <CalendarDays />
          <b>{day.data?.stops.length ?? "—"}</b>
          <span>stops today</span>
          <small>One shared itinerary</small>
        </button>
        <button
          className="care-stat"
          onClick={() => onTab("wellness")}
          disabled={!can("nutrition")}
        >
          <Flower2 />
          <b>{week.data?.checkin_days ?? "—"}</b>
          <span>check-in days this week</span>
          <small>Your streak garden</small>
        </button>
        <button
          className="care-stat"
          onClick={() => onTab(clinician ? "triage" : "chat")}
          disabled={clinician ? !can("clinician") : !can("chat")}
        >
          <HeartHandshake />
          <b>{clinician ? (command.data?.open_alerts ?? "—") : "Together"}</b>
          <span>{clinician ? "open care alerts" : "your care circle"}</span>
          <small>
            {clinician ? "Review and escalate" : "Ask, share, feel heard"}
          </small>
        </button>
      </div>
      {clinician && (
        <Panel
          title="Who needs a call today"
          hint="Ranked by explicit check-ins, alerts, missed doses, visits and personal step changes. This is triage support, not a clinical prediction."
        >
          <Load resource={command}>
            {(d) => (
              <>
                {d.patients.map((p) => (
                  <button
                    className={`care-risk-row risk-${p.risk || "green"}`}
                    key={p.patient_id}
                    onClick={() => onSelect(p.patient_id)}
                  >
                    <span className="care-risk-dot" />
                    <div>
                      <b>{p.name}</b>
                      <p>
                        {p.reasons?.join(" · ") ||
                          "No current rule-based concern"}
                      </p>
                    </div>
                    <span className="spacer" />
                    {p.rescue && (
                      <span className="care-pill">Navigator follow-up</span>
                    )}
                    <b>{p.score ?? ""}</b>
                  </button>
                ))}
                <details>
                  <summary>
                    Hospital overview · chairs, diagnosis-to-treatment and
                    drop-out rescue
                  </summary>
                  <p>
                    {d.awaiting_approval ?? "—"} clinical requests await review.
                  </p>
                  {d.patients.map((p) => (
                    <p className="small" key={p.patient_id}>
                      {p.name}: {p.diagnosis_days ?? "unknown"} days since
                      recorded diagnosis
                      {p.rescue
                        ? " · Review travel, missed visits and cost support"
                        : ""}
                    </p>
                  ))}
                  {d.chairs.map((c) => (
                    <p key={c.id}>
                      Chair {c.data.chair}: {c.patient_id} · {c.data.prep}
                    </p>
                  ))}
                  <p className="small muted">
                    Assign a rescue call, chair or nurse handover in Plans &
                    journal.
                  </p>
                </details>
              </>
            )}
          </Load>
        </Panel>
      )}
      <div className="care-columns">
        <Panel
          title="The next step"
          hint={
            patient?.current_regimen ||
            "Your signed plan lives in the shared folder."
          }
        >
          <div className="care-next-actions">
            {[
              ["clinical", "Treatment roadmap"],
              ["journal", "Visit takeaways & shared decisions"],
              ["companion", "Explain a report or find a result"],
              ["money", "Money and scheme support"],
            ]
              .filter(([k]) => visibleTabs.includes(k))
              .map(([key, label]) => (
                <button key={key} onClick={() => onTab(key)}>
                  {label}
                  <span>→</span>
                </button>
              ))}
          </div>
        </Panel>
        <Panel
          title={
            user.role === "doctor"
              ? "One-page clinician brief"
              : "Your care, your choices"
          }
        >
          {user.role === "doctor" ? (
            <>
              <Action
                className="btn primary"
                run={() =>
                  request("/brief", "POST", {
                    patient_id: pid,
                    visit_type: "follow_up",
                  })
                }
                onDone={setBrief}
              >
                Read & build follow-up brief
              </Action>
              {brief && (
                <Voice
                  text={brief.content.summary
                    .map((x) => x.text)
                    .join(" ")
                    .split(/\s+/)
                    .slice(0, 140)
                    .join(" ")}
                />
              )}
              <p className="small muted">
                Voice command: “build brief”, “show last three CBCs”, or ask the
                chart. Audio reads an abbreviated summary.
              </p>
              <Voice onText={voiceCommand} />
              {commandAnswer && (
                <div className="care-notice">
                  <p>{commandAnswer.answer}</p>
                  <SourceLinks
                    sources={commandAnswer.sources}
                    onOpen={onOpen}
                  />
                </div>
              )}
              <a
                className="btn"
                href={`/api/v2/patients/${pid}/pack.pdf`}
                target="_blank"
                rel="noreferrer"
              >
                Download tumour board pack
              </a>
            </>
          ) : (
            <>
              <p>
                Invite someone you trust, write down your priorities and check
                who has opened your records.
              </p>
              <button className="btn" onClick={() => onTab("privacy")}>
                Who opened my records
              </button>
            </>
          )}
        </Panel>
      </div>
      {["doctor", "nurse"].includes(user.role) && (
        <SmartInbox onSelect={onSelect} />
      )}
      {brief && (
        <Brief data={brief} onOpen={(tag) => onOpen(Number(tag.slice(1)))} />
      )}
    </div>
  );
}

export function SharedCard() {
  const { token } = useParams(),
    resource = useResource(`/shared/${token}`);
  return (
    <div className="care-shared-page">
      <Panel
        title="OncoBrief · consented care summary"
        hint="Only fields selected by the patient appear here. This link expires and may be withdrawn."
      >
        <Load resource={resource}>
          {(d) => (
            <>
              <h2>{d.patient_id}</h2>
              <p>
                {d.kind.replaceAll("_", " ")} · expires {dateTime(d.expires_at)}
              </p>
              {Object.entries(d)
                .filter(
                  ([k]) => !["patient_id", "kind", "expires_at"].includes(k),
                )
                .map(([k, v]) => (
                  <section className="care-record" key={k}>
                    <h3>{nice(k)}</h3>
                    {typeof v === "object" ? (
                      <pre className="care-pre">
                        {k === "summary" ? v.text : JSON.stringify(v, null, 2)}
                      </pre>
                    ) : (
                      <p>{v || "Not recorded"}</p>
                    )}
                  </section>
                ))}
              <p className="care-notice">
                Confirm dates and facts with the treating team. Opening an
                emergency QR alerts the care team to verify the patient's
                location.
              </p>
              <button className="btn" onClick={() => window.print()}>
                Print this summary
              </button>
            </>
          )}
        </Load>
      </Panel>
    </div>
  );
}
