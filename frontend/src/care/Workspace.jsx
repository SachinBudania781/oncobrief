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
  ArrowRight,
  Search,
  Info,
  Ellipsis,
} from "lucide-react";
import Modal from "./Modal";
import { useAuth } from "./Auth";
import Login from "./Login";
import { request, useResource, dateTime, nice } from "./client";
import {
  Action,
  Empty,
  Error,
  Load,
  Panel,
  SourceLinks,
  Voice,
} from "./UI";
import { CheckIn, Medicines, Wellness } from "./PatientTools";
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
import AIAssistantWidget from "./AIAssistantWidget";
import Wearables from "./Wearables";
import Transport from "./Transport";
import "./interface.css";

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
    [revision, setRevision] = useState(0),
    [wearableFocus, setWearableFocus] = useState({ metric: "steps", revision: 0 });
  const [qr, setQr] = useState(false),
    [qrError, setQrError] = useState("");
  const [focusedRecordId, setFocusedRecordId] = useState(null);
  const [transportOpened, setTransportOpened] = useState(false);
  const [about, setAbout] = useState(false), [searchOpen, setSearchOpen] = useState(false), [query, setQuery] = useState("");
  const [phoneCheckin, setPhoneCheckin] = useState(false);
  const portal = ["patient", "caregiver"].includes(user.role) ? "patient" : user.role === "doctor" ? "doctor" : "staff";
  const classicPath = portal === "patient"
    ? "/legacy/patient"
    : user.role === "doctor"
      ? "/legacy/doctor"
      : ["nurse", "lab", "frontdesk", "admin"].includes(user.role)
        ? "/legacy/staff"
        : null;
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
    admin: ["home", "transport", "schedule", "wearables", "privacy", "settings"],
  };
  const nav = NAV.filter(
    (n) =>
      can(n[3]) && (!roleTabs[user.role] || roleTabs[user.role].includes(n[0])) && (n[0] !== "wearables" || ["patient", "caregiver", "doctor", "nurse", "navigator", "frontdesk", "admin"].includes(user.role)) &&
      (n[0] !== "transport" || ["patient", "caregiver", "frontdesk", "navigator", "nurse", "admin"].includes(user.role)),
  );
  useEffect(() => {
    if (!nav.some((n) => n[0] === tab)) setTab("home");
  }, [pid]);
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
  const title = tab === "home" ? (portal === "patient" ? "Your care, connected." : portal === "doctor" ? "Your clinical workspace." : "Your hospital workspace.") : nav.find((n) => n[0] === tab)?.[1] || "Overview";
  const dockKeys = portal === "patient" ? ["home", "checkin", "records", "chat"] : portal === "doctor" ? ["home", "clinical", "approvals", "records"] : ["home", "day", "schedule", "records", "triage", "journal", "privacy"];
  const dock = dockKeys.map(k => nav.find(n => n[0] === k)).filter(Boolean).slice(0, 4);
  return (
    <div className={`care-app portal-${portal}`}>
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
        <p className="care-nav-label">WORKSPACE</p>
        <nav aria-label="Workspace navigation">
          {nav.map(([key, label, Icon]) => (
            <button
              key={key}
              className={tab === key ? "active" : ""}
              aria-current={tab === key ? "page" : undefined}
              onClick={() => change(key)}
            >
              <Icon size={18} />
              {label}
              {key === "triage" && <span className="care-live-dot" />}
            </button>
          ))}
        </nav>
        {classicPath && (
          <Link className="care-classic-link" to={classicPath}>
            <ArrowRight size={16} />
            <span>Classic Round 1 interface<small>Original portal screens</small></span>
          </Link>
        )}
        <button className="care-sidebar-foot" onClick={() => setAbout(true)}><ShieldCheck size={19} /><span>Made for connected care<small>Workspace information</small></span><ArrowUpRight size={15} /></button>
      </aside>
      <div className="care-page">
        <header className="care-top">
          <div className="care-mobile-logo"><span className="care-brand-mark"><HeartPulse size={20} /></span><b>OncoBrief</b></div>
          <div className="care-breadcrumb">
            <span className="care-connection-dot" />{nice(portal)} workspace <span>/</span> <b>{nav.find(n => n[0] === tab)?.[1]}</b>
          </div>
          <div className="spacer" />
          <button className="care-search-trigger" onClick={() => { setQuery(""); setSearchOpen(true); }} aria-label="Find a feature"><Search size={16} /><span>Find anything</span></button>
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
            <div className="care-view" key={`${pid}-${tab}`}>
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
                    <Panel title="Prefer to speak?"><p className="muted small">A voice-guided check-in, at your pace.</p><button className="btn" onClick={() => setPhoneCheckin(true)}>Open voice check-in <ArrowUpRight size={16} /></button></Panel>
                  </div>
                </div>
              )}
              {tab === "companion" && (
                <AIAssistantWidget
                  pid={pid}
                  language={language}
                  onOpen={setDocId}
                  embedded
                  userRole={user.role}
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
      <nav className="care-mobile-dock" aria-label="Mobile navigation">{dock.map(([key, label, Icon]) => <button key={key} className={tab === key ? "active" : ""} aria-current={tab === key ? "page" : undefined} onClick={() => change(key)}><Icon size={21} /><span>{({ home: "Home", checkin: "Check-in", records: "Records", chat: "Circle", clinical: "Journey", approvals: "Approvals", schedule: "Schedule", day: "Day pass", privacy: "Privacy", journal: "Plans", triage: "Triage" })[key] || label}</span></button>)}<button className={menu || !dock.some(n => n[0] === tab) ? "active" : ""} onClick={() => setMenu(true)}><Ellipsis size={23} /><span>More</span></button></nav>
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
  const careTeam = !["patient", "caregiver"].includes(user.role);
  const command = useResource(clinician ? "/v2/command-centre" : null, 15000);
  const week = useResource(can("activity") ? `/v2/patients/${pid}/week` : null);
  const day = useResource(
    can("appointments") ? `/v2/patients/${pid}/day-pass` : null,
  );
  const meds = useResource(
    can("medicines") ? `/patients/${pid}/medications` : null,
  );
  const documents = useResource(visibleTabs.includes("records") && careTeam && !clinician ? `/patients/${pid}/documents` : null);
  const stats = (clinician ? [
    ["home", Users, command.data?.patients.length ?? "—", "assigned patients", "Care overview"],
    ["approvals", ClipboardList, command.data?.awaiting_approval ?? "—", "decisions awaiting review", "Open approvals"],
    ["triage", HeartPulse, command.data?.open_alerts ?? "—", "open care alerts", "Review triage"],
    ["day", CalendarDays, day.data?.stops.length ?? "—", "patient stops today", "View day pass"],
    ["schedule", LayoutDashboard, command.data?.chairs.length ?? "—", "chair assignments", "Open schedule"],
    ["chat", HeartHandshake, "Connected", "care circle", "Open conversation"],
    ["privacy", ShieldCheck, "Access", "devices & privacy", "Review access"],
    ["settings", Settings2, "Services", "connected workspace", "Open settings"],
  ] : careTeam ? [
    ["records", FileStack, documents.data?.length ?? "—", "accessible reports", "Open records"],
    ["wellness", Flower2, "Wellbeing", "patient support", "Open wellbeing"],
    ["journal", BookHeart, "Care plans", "shared patient journal", "Open plans"],
    ["privacy", ShieldCheck, "Access", "devices & privacy", "Review access"],
    ["settings", Settings2, "Services", "connected workspace", "Open settings"],
  ] : [
    ["medicines", Pill, meds.data?.length ?? "—", "active medicines", "View prescriptions"],
    ["day", CalendarDays, day.data?.stops.length ?? "—", "stops today", "View day pass"],
    ["wellness", Flower2, week.data?.checkin_days ?? "—", "check-in days this week", "Your wellbeing"],
    ["chat", HeartHandshake, "Together", "your care circle", "Stay connected"],
  ]).filter(s => visibleTabs.includes(s[0])).slice(0, 4);
  const primaryTab = careTeam ? ({doctor:"approvals",nurse:"triage",frontdesk:"schedule",admin:"schedule",lab:"records",navigator:"journal",dietitian:"wellness",privacy:"privacy"}[user.role]) : visibleTabs.includes("checkin") ? "checkin" : "day";
  const primaryLabel = {approvals:"Review approvals",triage:"Open triage",schedule:"Open schedule",records:"Open reports",journal:"Open care plans",wellness:"Open wellbeing",privacy:"Review access",checkin:"Daily check-in",day:"Today’s appointments"}[primaryTab];
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
            <span className="care-connection-dot" />{careTeam ? "YOUR DAY, IN FOCUS" : "HERE FOR EVERY STEP"}
          </span>
          <h2>
            {careTeam
              ? `Welcome back, ${user.name.replace(/^Dr\.\s*/, "Dr. ").split(" ").slice(0, 3).join(" ")}.`
              : `Hello, ${patient?.name?.split(" ")[0] || user.name.split(" ")[0]}.`}
            <br />
            {careTeam
              ? "Good care starts with a clear view."
              : "A little clarity. A better day."}
          </h2>
          <p>
            {careTeam
              ? "Your patients, priorities and next decisions. Together in one place."
              : "Your team is with you, between every visit. Let’s take the next step together."}
          </p>
          <div className="row wrap">
            {visibleTabs.includes(primaryTab) && (
              <button
                className="btn care-white"
                onClick={() => onTab(primaryTab)}
              >
                {primaryLabel} <ArrowUpRight size={17} />
              </button>
            )}
            {visibleTabs.includes("day") && primaryTab !== "day" && (
              <button
                className="btn care-outline-white"
                onClick={() => onTab("day")}
              >
                Today’s appointments <ArrowRight size={16} />
              </button>
            )}
          </div>
        </div>
        <div className="care-welcome-art" aria-hidden="true">
          <div className="hero-orbit hero-orbit-one" /><div className="hero-orbit hero-orbit-two" /><div className="hero-glass-core"><HeartPulse size={55} strokeWidth={1.15} /></div><div className="hero-care-tag"><span className="care-connection-dot" />A connected care story</div><svg className="hero-pulse" viewBox="0 0 300 60"><path d="M0 30H65L80 30 92 13 109 49 126 22 139 30H300" /></svg>
        </div>
      </section>
      <div className="care-section-label"><h2>{careTeam ? "At a glance" : "Your day, at a glance"}</h2><span>{patient?.id}</span></div>
      <div className="care-summary-grid" style={{ "--stat-count": stats.length }}>
        {stats.map(([key, Icon, value, label, detail]) => <button key={key} className="care-stat" onClick={() => onTab(key)}><Icon /><b className={typeof value === "string" && value.length > 6 ? "care-stat-word" : ""}>{value}</b><span>{label}</span><small>{detail}<ArrowUpRight size={13} /></small></button>)}
      </div>
      {clinician && (
        <Panel
          title={["doctor", "nurse"].includes(user.role) ? "Patient priorities" : "Patient coordination"}
          hint="Ranked by explicit check-ins, alerts, missed doses, visits and personal step changes. This is triage support, not a clinical prediction."
        >
          <Load resource={command}>
            {(d) => (
              <>
                {d.patients.map((p) => (
                  <button
                    className={`care-risk-row risk-${p.risk || "neutral"}`}
                    key={p.patient_id}
                    onClick={() => onSelect(p.patient_id)}
                  >
                    <span className="care-risk-dot" />
                    <div>
                      <b>{p.name}</b>
                      <p>
                        {p.reasons?.join(" · ") || (["doctor", "nurse", "admin"].includes(user.role) ? "No current rule-based concern" : `${p.patient_id} · Care coordination`)}
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
              ["records", "Patient reports & uploads"],
              ["schedule", "Schedule & chair management"],
              ["day", "Hospital day pass"],
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
              : careTeam ? "Your workspace" : "Your care, your choices"
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
              <details className="care-inline-help"><summary>Voice shortcuts</summary><p className="small muted">
                Voice command: “build brief”, “show last three CBCs”, or ask the
                chart. Audio reads an abbreviated summary.
              </p></details>
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
              <p>{careTeam ? "Your assigned folders and hospital services, close at hand." : "Invite someone you trust, write down your priorities and check who has opened your records."}</p>
              <button className="btn" onClick={() => onTab("privacy")}>
                {careTeam ? "Privacy & devices" : "Who opened my records"}
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
