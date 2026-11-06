import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Bell,
  BookHeart,
  CalendarDays,
  Car,
  CircleHelp,
  ClipboardList,
  FileStack,
  History,
  Flower2,
  HeartHandshake,
  HeartPulse,
  Home,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  Pill,
  Settings2,
  ShieldCheck,
  Stethoscope,
  Users,
  Watch,
  QrCode,
  ArrowUpRight,
  Search,
  Info,
  Ellipsis,
} from "lucide-react";
import Modal from "./Modal";
import { useAuth } from "./Auth";
import Login from "./Login";
import { request, useResource, dateTime, hospitalDateTime, nice } from "./client";
import { ClinicDesk, StaffActivity } from "./DoctorStaffTools";
import {
  Action,
  Empty,
  Error,
  Load,
  Panel,
} from "./UI";
import { CheckIn, DoctorMedicineSummary, DoseReminder, Medicines, Wellness } from "./PatientTools";
import {
  AlertConsole,
  ApprovalQueue,
  ClinicalChart,
  PatientCheckInHistory,
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
import "./care.css";
import AIAssistantWidget from "./AIAssistantWidget";
import Wearables from "./Wearables";
import Transport from "./Transport";
import "./interface.css";
import "./finish.css";
import Dashboard from "./Dashboard";

const NAV = [
  ["home", "Overview", Home, "profile"],
  ["checkin", "Daily check-in", HeartPulse, "checkin"],
  ["companion", "AI Chat", MessageCircle, "documents"],
  ["medicines", "Medicines & requests", Pill, "medicines"],
  ["clinical", "Care journey", Stethoscope, "documents"],
  ["journal", "Plans & journal", BookHeart, "notes"],
  ["chat", "Care circle chat", HeartHandshake, "chat"],
  ["day", "Hospital day pass", CalendarDays, "appointments"],
  ["transport", "Transport", Car, "appointments"],
  ["wellness", "Wellbeing", Flower2, "nutrition"],
  ["wearables", "Wearables", Watch, "activity"],
  ["records", "Reports & uploads", FileStack, "documents"],
  ["money", "Money & schemes", CircleHelp, "finance"],
  ["circle", "Caregiver consent", Users, "patient"],
  ["share", "Emergency card", ShieldCheck, "patient"],
  ["triage", "Nurse triage", HeartPulse, "clinician"],
  ["approvals", "Doctor approvals", ClipboardList, "doctor"],
  ["clinic", "Clinic & visit briefs", ClipboardList, "doctor"],
  ["staffActivity", "Uploads & access log", History, "staffActivity"],
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
    calendar = useResource("/taxonomy"),
    notes = useResource("/v2/notifications", 15000);
  const entry = new URLSearchParams(window.location.search);
  const requestedPatient = entry.get("patient_id");
  const allowedEntry = user.patient_ids.includes(requestedPatient);
  const [pid, setPid] = useState(allowedEntry ? requestedPatient : user.patient_ids[0] || ""),
    [tab, setTab] = useState(allowedEntry ? entry.get("view") || "home" : "home"),
    [docId, setDocId] = useState(allowedEntry && /^\d+$/.test(entry.get("document_id") || "") ? Number(entry.get("document_id")) : null),
    [language, setLanguage] = useState("en"),
    [menu, setMenu] = useState(false),
    [showNotifications, setShowNotifications] = useState(false),
    [revision, setRevision] = useState(0),
    [wearableFocus, setWearableFocus] = useState({ metric: "steps", revision: 0 });
  const [qr, setQr] = useState(false),
    [qrError, setQrError] = useState("");
  const [focusedRecordId, setFocusedRecordId] = useState(null);
  const [transportOpened, setTransportOpened] = useState(false);
  const [about, setAbout] = useState(false), [searchOpen, setSearchOpen] = useState(false), [query, setQuery] = useState("");
  const [phoneCheckin, setPhoneCheckin] = useState(false);
  const portal = ["patient", "caregiver"].includes(user.role) ? "patient" : user.role === "doctor" ? "doctor" : "staff";
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
    if (scope === "staffActivity")
      return ["nurse", "lab", "admin"].includes(user.role);
    const scopes = user.permissions?.[pid] || [];
    return (
      scopes.includes("all") || scopes.includes(scope) || scope === "profile"
    );
  };
  const roleTabs = {
    lab: ["home", "records", "staffActivity", "privacy", "settings"],
    dietitian: [
      "home",
      "journal",
      "records",
      "wellness",
      "privacy",
      "settings",
    ],
    frontdesk: ["home", "day", "transport", "schedule", "wearables", "privacy", "settings"],
    navigator: [
      "home",
      "journal",
      "chat",
      "day",
      "transport",
      "money",
      "wearables",
      "privacy",
      "settings",
    ],
    privacy: ["home", "privacy", "settings"],
    admin: ["home", "records", "staffActivity", "transport", "schedule", "wearables", "privacy", "settings"],
  };
  const nav = NAV.filter(
    (n) =>
      can(n[3]) && (!roleTabs[user.role] || roleTabs[user.role].includes(n[0])) &&
      (user.role !== "doctor" || !["day", "wellness", "wearables", "money", "privacy", "settings"].includes(n[0])) &&
      (n[0] !== "wearables" || ["patient", "caregiver", "doctor", "nurse", "navigator", "frontdesk", "admin"].includes(user.role)) &&
      (n[0] !== "transport" || ["patient", "caregiver", "frontdesk", "navigator", "nurse", "admin"].includes(user.role)),
  );
  useEffect(() => {
    if (!nav.some((n) => n[0] === tab)) setTab("home");
  }, [pid, tab]);
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("patient_id", pid);
    url.searchParams.set("view", tab);
    url.searchParams.delete("document_id");
    if (tab !== "transport") url.searchParams.delete("appointment_id");
    window.history.replaceState(null, "", url);
  }, [pid, tab]);
  useEffect(() => {
    if (patient?.preferred_language) setLanguage(patient.preferred_language);
  }, [patient?.id]);
  const change = (value) => {
    if (value === "transport") setTransportOpened(true);
    setTab(value);
    setMenu(false);
    setSearchOpen(false);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const unread = notes.data?.filter((n) => n.status === "unread").length || 0;
  const title = tab === "home" ? (portal === "patient" ? `Hello, ${patient?.name?.split(" ")[0] || user.name.split(" ")[0]}.` : portal === "doctor" ? "Clinical overview" : "Care operations") : nav.find((n) => n[0] === tab)?.[1] || "Overview";
  useEffect(() => {
    const openFinder = e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(v => !v);
        setQuery("");
      }
    };
    window.addEventListener("keydown", openFinder);
    return () => window.removeEventListener("keydown", openFinder);
  }, []);
  const navGroups = [
    ["Your workspace", ["home", "clinic", "checkin", "triage", "approvals", "records", "clinical", "medicines"]],
    ["Care & coordination", ["day", "schedule", "staffActivity", "companion", "journal", "chat", "transport", "wellness", "wearables", "money", "circle", "share"]],
    ["Account", ["privacy", "settings"]],
  ].map(([label, keys]) => [label, keys.map(key => nav.find(n => n[0] === key)).filter(Boolean)]).filter(([, items]) => items.length);
  const dockKeys = portal === "patient" ? ["home", "checkin", "records", "chat"] : portal === "doctor" ? ["home", "clinic", "approvals", "records"] : ["home", "day", "schedule", "staffActivity", "records", "triage", "journal", "privacy"];
  const dock = dockKeys.map(k => nav.find(n => n[0] === k)).filter(Boolean).slice(0, 4);
  return (
    <div className={`care-app portal-${portal}`}>
      <a className="care-skip-link" href="#care-content">Skip to content</a>
      {user.role === "patient" && pid && <DoseReminder pid={pid} onOpen={() => change("medicines")} />}
      <aside className={`care-sidebar ${menu ? "open" : ""}`}>
        <Link to="/" className="care-logo">
          <span className="care-brand-mark"><HeartPulse size={23} /></span>
          OncoBrief
        </Link>
        <span className="care-workspace-label">{portal} workspace</span>
        <div className="care-role">
          <span className="care-avatar">{user.name.slice(0, 1)}</span>
          <div>
            <b>{user.name}</b>
            <small>{user.sign_in_id || nice(user.role)}</small>
          </div>
        </div>
        <nav aria-label="Workspace navigation">
          {navGroups.map(([group, items]) => <div className="care-nav-group" key={group}><p className="care-nav-label">{group}</p>{items.map(([key, label, Icon]) => (
            <button
              key={key}
              className={tab === key ? "active" : ""}
              aria-current={tab === key ? "page" : undefined}
              onClick={() => change(key)}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}</div>)}
        </nav>
        <button className="care-sidebar-foot" onClick={() => setAbout(true)}><ShieldCheck size={19} /><span>Made for connected care<small>Workspace information</small></span><ArrowUpRight size={15} /></button>
      </aside>
      <div className="care-page">
        <header className="care-top">
          <div className="care-mobile-logo"><span className="care-brand-mark"><HeartPulse size={20} /></span><b>OncoBrief</b></div>
          <div className="care-breadcrumb">
            <span className="care-connection-dot" />{nice(portal)} workspace <span>/</span> <b>{nav.find(n => n[0] === tab)?.[1]}</b>
          </div>
          <div className="spacer" />
          <button className="care-search-trigger" onClick={() => { setQuery(""); setSearchOpen(true); }} aria-label="Find a feature" aria-keyshortcuts="Control+k Meta+k"><Search size={16} /><span>Find a feature</span><kbd>{navigator.platform?.includes("Mac") ? "⌘ K" : "Ctrl K"}</kbd></button>
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
          <button className="btn icon-btn care-hide-mobile" aria-label="Workspace information" onClick={() => setAbout(true)}><Info size={18} /></button>
          <button className="btn" aria-label="Sign out" onClick={logout}>
            <LogOut size={16} />
            <span className="care-hide-mobile">Sign out</span>
          </button>
        </header>
        <main className="care-main" id="care-content" tabIndex={-1}>
          <div className="care-page-heading">
            <div>
              <p className="eyebrow">
                {calendar.data?.hospital_today ? hospitalDateTime(calendar.data.hospital_today) : ""}
              </p>
              <h1>{title}</h1>
              {tab === "home" && <p className="care-heading-subtitle">{portal === "patient" ? "A little clarity for the day ahead." : `Welcome back, ${user.name}. Here’s your workspace today.`}</p>}
            </div>
            <div className="care-heading-actions">
            {["doctor", "nurse", "frontdesk", "lab"].includes(user.role) && <button className="btn care-scan" onClick={() => setQr(true)}><QrCode size={18} /><span>Scan patient</span></button>}
            {patients.data?.length > 0 && (
              <label className="care-patient-select">
                <span>{portal === "patient" ? "Care profile" : "Active patient"}</span>
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
            <Modal title="Notifications" onClose={() => setShowNotifications(false)}>
              {notes.data?.length ? (
                notes.data.map((n) => (
                  <article className="care-record" key={n.id}>
                    <b>{n.title}</b>
                    <p>{n.body}</p>
                    <small className="muted">{dateTime(n.created_at)}</small>
                    {["activity", "vitals"].includes(n.channel) && n.patient_id && (
                      <button className="btn" onClick={() => {
                        setPid(n.patient_id);
                        const metric = n.channel === "activity"
                          ? "steps"
                          : n.title.toLowerCase().includes("oxygen")
                            ? "spo2"
                            : n.title.toLowerCase().includes("blood pressure")
                              ? (n.title.toLowerCase().includes("diastolic") ? "diastolic" : "systolic")
                              : n.title.toLowerCase().includes("temperature")
                                ? "temperature_c"
                                : "heart_rate";
                        setWearableFocus((current) => ({ metric, revision: current.revision + 1 }));
                        change("wearables");
                        setShowNotifications(false);
                      }}>
                        {n.channel === "activity" ? "View activity trend" : "View vital trend"}
                      </button>
                    )}
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
            </Modal>
          )}
          {!pid &&
          tab !== "settings" &&
          tab !== "privacy" &&
          tab !== "schedule" &&
          tab !== "clinic" &&
          tab !== "staffActivity" ? (
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
            <div className="care-view" key={`${pid}-${tab}`}>
              {tab === "home" && (
                <Dashboard
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
                user.role === "doctor" ? (
                  <PatientCheckInHistory pid={pid} canReviewActivity={can("activity")} onOpen={setDocId} demo={Boolean(user.demo)} />
                ) : <div className="care-columns">
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
                    <Panel title="Prefer to speak?"><p className="muted small">A voice-guided check-in, at your pace.</p><button className="btn" onClick={() => setPhoneCheckin(true)}>Open voice check-in <ArrowUpRight size={16} /></button></Panel>
                  </div>
                </div>
              )}
              {tab === "companion" && (
                <AIAssistantWidget
                  pid={pid}
                  language={language}
                  onOpen={setDocId}
                  onExit={() => change("home")}
                  embedded
                  userRole={user.role}
                />
              )}
              {tab === "medicines" && (
                user.role === "doctor" ? <DoctorMedicineSummary pid={pid} /> :
                  <Medicines
                    pid={pid}
                    user={user}
                    onUpdate={() => setRevision((v) => v + 1)}
                  />
              )}
              {tab === "clinical" && (
                <ClinicalChart pid={pid} user={user} onOpen={setDocId} />
              )}
              {tab === "clinic" && (
                <ClinicDesk
                  patients={patients.data || []}
                  pid={pid}
                  onSelect={setPid}
                  onOpen={setDocId}
                  onRecords={() => change("records")}
                />
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
              {tab === "chat" && <CareChat pid={pid} user={user} />}
      {tab === "day" && <DayPass pid={pid} user={user} />}
              {tab === "wellness" && (
                <Wellness
                  pid={pid}
                  language={language}
                  canTeachBack={can("notes")}
                  viewerRole={user.role}
                />
              )}
              {(tab === "transport" || transportOpened) && <Transport pid={pid} user={user} active={tab === "transport"} />}
              {tab === "wearables" && <Wearables pid={pid} demo={Boolean(user.demo)} viewerRole={user.role} focusMetric={wearableFocus.metric} focusRevision={wearableFocus.revision} />}
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
              {tab === "staffActivity" && <StaffActivity user={user} onOpen={(id) => setDocId(Number(id))} />}
              {tab === "privacy" && <Privacy pid={pid} user={user} />}
              {tab === "settings" && (
                <Integrations pid={pid} user={user} language={language} />
              )}
            </div>
          )}
          <footer className="care-footer">
            <span>OncoBrief <span className="footer-dot">·</span> Connected cancer care</span><button onClick={() => setAbout(true)}><ShieldCheck size={13} /> Privacy & workspace information</button>
          </footer>
        </main>
      </div>
      <nav className="care-mobile-dock" aria-label="Mobile navigation">{dock.map(([key, label, Icon]) => <button key={key} className={tab === key ? "active" : ""} aria-current={tab === key ? "page" : undefined} onClick={() => change(key)}><Icon size={21} /><span>{({ home: "Home", checkin: "Check-in", records: "Records", chat: "Circle", clinical: "Journey", clinic: "Clinic", staffActivity: "Activity", approvals: "Approvals", schedule: "Schedule", day: "Day pass", privacy: "Privacy", journal: "Plans", triage: "Triage" })[key] || label}</span></button>)}<button className={menu || !dock.some(n => n[0] === tab) ? "active" : ""} aria-expanded={menu} aria-haspopup="dialog" onClick={() => setMenu(true)}><Ellipsis size={23} /><span>More</span></button></nav>
      {menu && <Modal title="Your workspace" className="care-more-sheet" onClose={() => setMenu(false)}><div className="care-sheet-profile"><span className="care-avatar">{user.name.slice(0, 1)}</span><div><b>{user.name}</b><small>{user.sign_in_id || nice(user.role)}</small></div></div><div className="care-feature-grid">{nav.map(([key, label, Icon]) => <button className={tab === key ? "active" : ""} key={key} onClick={() => change(key)}><Icon size={22} /><span>{label}</span></button>)}</div><div className="care-sheet-footer"><button className="btn" onClick={() => { setMenu(false); setAbout(true); }}><Info size={17} />Information</button><button className="btn" onClick={logout}><LogOut size={17} />Sign out</button></div></Modal>}
      {searchOpen && <Modal title="Find a feature" onClose={() => setSearchOpen(false)}><input className="input care-command-input" type="search" data-autofocus placeholder="Search your workspace…" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search features" /><div className="care-command-results">{nav.filter(n => n[1].toLowerCase().includes(query.toLowerCase())).map(([key, label, Icon]) => <button key={key} onClick={() => change(key)}><Icon size={19} />{label}<ArrowUpRight size={16} /></button>)}{!nav.some(n => n[1].toLowerCase().includes(query.toLowerCase())) && <Empty>No features found.</Empty>}</div></Modal>}
      {about && <Modal title="About your workspace" onClose={() => setAbout(false)}><div className="care-information"><div className="care-modal-brand"><HeartPulse size={28} /><b>OncoBrief</b><span>Connected cancer care</span></div>{user.demo && <div className="care-notice"><b>Hackathon environment</b><p>All patients, reports and relationships here are fabricated. Please keep real patient information out of this workspace.</p></div>}<h3>Your information, shared with care</h3><p>Each account sees only its assigned patients and consented information. Caregivers have their own access. Record access is logged; you can review it in Privacy & devices.</p><h3>Your team makes clinical decisions</h3><p>AI-assisted explanations and drafts support the care team. Treatment changes require the treating doctor’s review and signature. Urgent symptoms need prompt medical attention.</p><p className="small muted">Connected services show their current availability in Settings. Browser voice may use your browser’s speech provider. Patient documents are not stored for offline use.</p></div></Modal>}
      {phoneCheckin && <Modal title="Voice check-in" onClose={() => setPhoneCheckin(false)}><CheckIn pid={pid} language={language} phoneDemo onUpdate={() => setRevision(v => v + 1)} /></Modal>}
      {qr && (
        <QrScanner
          onClose={() => setQr(false)}
          onResult={(id) => {
            setQr(false);
            if (user.patient_ids.includes(id)) {
              setPid(id);
              setQrError("");
              if (user.role === "doctor") change("clinic");
            } else
              setQrError(
                "This QR does not belong to a patient assigned to your account.",
              );
          }}
        />
      )}
      {docId && <DocViewer docId={docId} onClose={() => setDocId(null)} />}
      {["patient", "doctor"].includes(portal) && can("documents") && pid && tab !== "companion" && <AIAssistantWidget pid={pid} language={language} onOpen={setDocId} userRole={user.role} />}
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
