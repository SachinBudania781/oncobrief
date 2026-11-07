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
  EyeOff,
  MonitorPlay,
  CheckCheck,
  Route,
  Mic,
  Orbit,
  PersonStanding,
  ArrowLeft,
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
import "./polish.css";
import "./aura.css";
import Dashboard from "./Dashboard";
import QueueBoard from "./QueueBoard";
import { askNotificationPermission, useLiveNotifications, GlobalSearch, InstallButton, OfflineBanner, PrivacyCurtain, ShortcutsHelp, SosButton, TextSizeControl, Toaster, WelcomeTour, usePrivacyScreen, useTextSize } from "./Extras";
import { toast } from "./toast";
import { Aurora, ScrollGloss } from "./Glass3D";
import ConsultStudio from "./ConsultStudio";
import BodyMap from "./BodyMap";
import CycleCompass from "./CycleCompass";

const NAV = [
  ["home", "Overview", Home, "profile"],
  ["scribe", "Consult studio", Mic, "doctor"],
  ["cycle", "Treatment cycle", Orbit, "documents"],
  ["bodymap", "Symptom map", PersonStanding, "checkin"],
  ["checkin", "Check-ins", HeartPulse, "checkin"],
  ["companion", "Assistant", MessageCircle, "documents"],
  ["medicines", "Medicines", Pill, "medicines"],
  ["clinical", "Care journey", Route, "documents"],
  ["journal", "Care plan", BookHeart, "notes"],
  ["chat", "Messages", HeartHandshake, "chat"],
  ["day", "Appointments", CalendarDays, "appointments"],
  ["transport", "Transport", Car, "appointments"],
  ["wellness", "Wellbeing", Flower2, "nutrition"],
  ["wearables", "Wearables", Watch, "activity"],
  ["records", "Reports", FileStack, "documents"],
  ["money", "Financial help", CircleHelp, "finance"],
  ["circle", "Caregivers", Users, "patient"],
  ["share", "Emergency card", ShieldCheck, "patient"],
  ["triage", "Triage", HeartPulse, "clinician"],
  ["approvals", "Approvals", ClipboardList, "doctor"],
  ["clinic", "Clinic", Stethoscope, "doctor"],
  ["staffActivity", "Activity log", History, "staffActivity"],
  ["schedule", "Schedule", LayoutDashboard, "staff"],
  ["queue", "Queue display", MonitorPlay, "staff"],
  ["privacy", "Privacy", ShieldCheck, "profile"],
  ["settings", "Settings", Settings2, "profile"],
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
  const [textSize, setTextSize] = useTextSize();
  const [privacyOn, setPrivacyOn] = usePrivacyScreen();
  useLiveNotifications(notes.data);
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
    frontdesk: ["home", "day", "transport", "schedule", "queue", "wearables", "privacy", "settings"],
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
    admin: ["home", "records", "staffActivity", "transport", "schedule", "queue", "wearables", "privacy", "settings"],
  };
  const nav = NAV.filter(
    (n) =>
      can(n[3]) && (!roleTabs[user.role] || roleTabs[user.role].includes(n[0])) &&
      (user.role !== "doctor" || !["day", "wellness", "wearables", "money", "privacy", "settings", "queue"].includes(n[0])) &&
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
    if (patient?.preferred_language && ["patient", "caregiver"].includes(user.role)) setLanguage(patient.preferred_language);
  }, [patient?.id]);
  const change = (value) => {
    if (value === "transport") setTransportOpened(true);
    if (value !== tab) {
      const url = new URL(window.location.href);
      url.searchParams.set("view", value);
      window.history.pushState({ view: value }, "", url);
    }
    setTab(value);
    setMenu(false);
    setSearchOpen(false);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const unread = notes.data?.filter((n) => n.status === "unread").length || 0;
  const hour = Number(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false }));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = portal === "patient" ? (patient?.name?.split(" ")[0] || user.name.split(" ")[0]) : user.name.replace(/^(Dr\.?|Nurse|Reception|Navigator|Dietitian|Lab technician)\s+/i, "").split(" ").slice(-1)[0];
  const title = tab === "home" ? `${greeting}, ${portal === "doctor" ? "Dr. " : ""}${firstName}` : nav.find((n) => n[0] === tab)?.[1] || "Overview";
  useEffect(() => { document.title = `${tab === "home" ? "Home" : nav.find((n) => n[0] === tab)?.[1] || "OncoBrief"} · OncoBrief`; }, [tab]);
  useEffect(() => {
    const onPop = () => {
      const view = new URLSearchParams(window.location.search).get("view") || "home";
      setTab(view); setMenu(false); setSearchOpen(false); setShowNotifications(false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    let lastG = 0;
    const openFinder = e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(v => !v);
        setQuery("");
        return;
      }
      const typing = /input|textarea|select/i.test(e.target.tagName) || e.target.isContentEditable;
      if (typing || e.ctrlKey || e.metaKey || e.altKey || document.querySelector(".care-modal")) return;
      if (e.key === "n") setShowNotifications(v => !v);
      if (e.key === "g") lastG = Date.now();
      else if (e.key === "h" && Date.now() - lastG < 900) change("home");
    };
    window.addEventListener("keydown", openFinder);
    return () => window.removeEventListener("keydown", openFinder);
  }, []);
  const navGroups = [
    ["Workspace", ["home", "scribe", "clinic", "cycle", "bodymap", "checkin", "triage", "approvals", "records", "clinical", "medicines", "companion"]],
    ["Care", ["day", "schedule", "queue", "staffActivity", "journal", "chat", "transport", "wellness", "wearables", "money", "circle", "share"]],
    ["Account", ["privacy", "settings"]],
  ].map(([label, keys]) => [label, keys.map(key => nav.find(n => n[0] === key)).filter(Boolean)]).filter(([, items]) => items.length);
  const dockKeys = portal === "patient" ? ["home", "medicines", "bodymap", "companion"] : portal === "doctor" ? ["home", "scribe", "clinic", "records"] : ["home", "day", "schedule", "staffActivity", "records", "triage", "journal", "privacy"];
  const dockLabel = { bodymap: "Symptoms", scribe: "Studio", cycle: "Cycle", home: "Home", checkin: "Check-in", records: "Reports", chat: "Messages", clinical: "Journey", clinic: "Clinic", staffActivity: "Activity", approvals: "Approvals", schedule: "Schedule", day: "Visits", privacy: "Privacy", journal: "Plan", triage: "Triage", medicines: "Medicines", companion: "Ask" };
  const dock = dockKeys.map(k => nav.find(n => n[0] === k)).filter(Boolean).slice(0, 4);
  const markAllRead = async () => {
    const pending = (notes.data || []).filter(n => n.status === "unread");
    await Promise.all(pending.map(n => request(`/v2/notifications/${n.id}/read`, "POST").catch(() => null)));
    notes.refresh();
    toast("All caught up");
  };
  const careTeam = portal !== "patient";
  const initials = user.name.replace(/^(Dr\.?|Nurse|Reception|Navigator|Dietitian|Lab technician)\s+/i, "").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  if (tab === "queue") return <><QueueBoard onExit={() => change("home")} /><Toaster /></>;
  return (
    <div className={`care-app portal-${portal} view-${tab}`}>
      <Aurora tone={portal} />
      <ScrollGloss />
      <a className="care-skip-link" href="#care-content">Skip to content</a>
      <OfflineBanner />
      {user.role === "patient" && pid && <DoseReminder pid={pid} onOpen={() => change("medicines")} />}
      <aside className={`care-sidebar ${menu ? "open" : ""}`}>
        <Link to="/" className="care-logo">
          <span className="care-brand-mark"><HeartPulse size={19} strokeWidth={2.2} /></span>
          OncoBrief
          <span className="ob-edition">{portal === "patient" ? "Care" : portal === "doctor" ? "Clinician" : "Hospital"}</span>
        </Link>
        <nav aria-label="Workspace navigation">
          {navGroups.map(([group, items]) => <div className="care-nav-group" key={group}><p className="care-nav-label">{group}</p>{items.map(([key, label, Icon]) => (
            <button
              key={key}
              className={tab === key ? "active" : ""}
              aria-current={tab === key ? "page" : undefined}
              onClick={() => change(key)}
            >
              <Icon size={18} />
              <span>{label}</span>
              {key === "approvals" && unread > 0 && <i className="ob-nav-dot" aria-hidden="true" />}
            </button>
          ))}</div>)}
        </nav>
        <div className="ob-sidebar-foot">
          <div className="care-role">
            <span className="care-avatar">{initials}</span>
            <div>
              <b>{user.name}</b>
              <small>{user.department || nice(user.role)}</small>
            </div>
            <button className="btn icon-btn" aria-label="Sign out" title="Sign out" onClick={logout}><LogOut size={16} /></button>
          </div>
        </div>
      </aside>
      <div className="care-page">
        <header className="care-top">
          <div className="care-mobile-logo"><span className="care-brand-mark"><HeartPulse size={17} strokeWidth={2.2} /></span><b>OncoBrief</b></div>
          <button className="care-search-trigger" onClick={() => { setQuery(""); setSearchOpen(true); }} aria-label="Search" aria-keyshortcuts="Control+k Meta+k"><Search size={16} /><span>{careTeam ? "Search patients, reports…" : "Search your reports…"}</span><kbd>{navigator.platform?.includes("Mac") ? "⌘K" : "Ctrl K"}</kbd></button>
          <div className="spacer" />
          {portal === "patient" && pid && <SosButton pid={pid} emergencyPhone={calendar.data?.emergency_phone} />}
          {careTeam && <button className="btn icon-btn care-hide-mobile" aria-label="Privacy screen" title="Privacy screen (Ctrl+Shift+L)" onClick={() => setPrivacyOn(true)}><EyeOff size={18} /></button>}
          <select
            className="select care-language"
            aria-label="Language"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          >
            <option value="en">EN</option>
            <option value="hi">हिंदी</option>
            <option value="mr">मराठी</option>
          </select>
          <button
            className="btn icon-btn care-bell"
            aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
            onClick={() => { askNotificationPermission(); setShowNotifications((v) => !v); }}
          >
            <Bell size={19} />
            {unread > 0 && <span>{unread > 9 ? "9+" : unread}</span>}
          </button>
        </header>
        <main className="care-main" id="care-content" tabIndex={-1}>
          <div className="care-page-heading">
            <div>
              {tab !== "home" && <button className="ob-back" onClick={() => change("home")} aria-label="Back to home"><ArrowLeft size={19} /></button>}
              <div>
                <p className="eyebrow">
                  {tab === "home" && calendar.data?.hospital_today ? new Date(calendar.data.hospital_today + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" }) : tab === "home" ? "" : patient?.name && portal !== "patient" ? patient.name : ""}
                </p>
                <h1>{title}</h1>
              </div>
            </div>
            <div className="care-heading-actions">
            {["doctor", "nurse", "frontdesk", "lab"].includes(user.role) && <button className="btn care-scan" onClick={() => setQr(true)}><QrCode size={18} /><span>Scan patient</span></button>}
            {patients.data?.length > 1 && (
              <label className="care-patient-select">
                <span>{portal === "patient" ? "Care profile" : "Patient"}</span>
                <select
                  className="select"
                  aria-label="Patient"
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
            <Panel title="Arrived at the hospital?">
              <p>
                Check in so every department you're booked with knows you're here.
              </p>
              <Action
                className="btn primary"
                run={() => request(`/v2/patients/${gate}/gate`, "POST")}
                onDone={() => {
                  setPid(gate);
                  change("day");
                  toast("You're checked in");
                }}
              >
                Check me in
              </Action>
            </Panel>
          )}
          {showNotifications && (
            <Modal title="Notifications" onClose={() => setShowNotifications(false)} className="ob-notifications">
              {unread > 0 && <button className="ob-markall" onClick={markAllRead}><CheckCheck size={16} />Mark all as read</button>}
              {notes.data?.length ? (
                notes.data.map((n) => (
                  <article className={`care-record ob-note ${n.status === "unread" ? "is-unread" : ""}`} key={n.id}>
                    <b>{n.title}</b>
                    <p>{n.body}</p>
                    <small className="muted">{dateTime(n.created_at)}</small>
                    <div className="row wrap">
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
                        {n.channel === "activity" ? "View activity" : "View trend"}
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
                    </div>
                  </article>
                ))
              ) : (
                <Empty>You're all caught up.</Empty>
              )}
            </Modal>
          )}
          {!pid &&
          tab !== "settings" &&
          tab !== "privacy" &&
          tab !== "schedule" &&
          tab !== "clinic" &&
          tab !== "staffActivity" ? (
            <Panel title="No patients assigned yet">
              <p>
                An administrator can assign patients to your account from Settings.
              </p>
              <div className="row wrap">
              {["frontdesk", "admin"].includes(user.role) && (
                <button className="btn" onClick={() => change("schedule")}>
                  Register a patient
                </button>
              )}
              <button
                className="btn primary"
                onClick={() => change("settings")}
              >
                Open settings
              </button>
              </div>
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
                      toast("Check-in saved. Your team can see it.");
                    }}
                  />
                  <div className="stack">
                    {can("notes") && <VisitPrep pid={pid} />}
                    <Panel title="Prefer to speak?"><p className="muted small">Answer the check-in by voice, at your own pace.</p><button className="btn" onClick={() => setPhoneCheckin(true)}>Start voice check-in <ArrowUpRight size={16} /></button></Panel>
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
              {tab === "scribe" && <ConsultStudio pid={pid} patient={patient} user={user} onTab={change} />}
              {tab === "bodymap" && <BodyMap pid={pid} user={user} patient={patient} onTab={change} />}
              {tab === "cycle" && <CycleCompass pid={pid} user={user} patient={patient} onTab={change} />}
              {tab === "settings" && (
                <Integrations pid={pid} user={user} language={language} />
              )}
            </div>
          )}
        </main>
      </div>
      <nav className="care-mobile-dock" aria-label="Mobile navigation">{dock.map(([key, label, Icon]) => <button key={key} className={tab === key ? "active" : ""} aria-current={tab === key ? "page" : undefined} onClick={() => change(key)}><Icon size={21} /><span>{dockLabel[key] || label}</span></button>)}<button className={menu || !dock.some(n => n[0] === tab) ? "active" : ""} aria-expanded={menu} aria-haspopup="dialog" onClick={() => setMenu(true)}><Ellipsis size={23} /><span>More</span></button></nav>
      {menu && <Modal title="Menu" className="care-more-sheet" onClose={() => setMenu(false)}><div className="care-sheet-profile"><span className="care-avatar">{initials}</span><div><b>{user.name}</b><small>{user.department || nice(user.role)}</small></div></div><div className="care-feature-grid">{nav.map(([key, label, Icon]) => <button className={tab === key ? "active" : ""} key={key} onClick={() => change(key)}><Icon size={22} /><span>{label}</span></button>)}</div><div className="ob-sheet-row"><span>Language</span><select className="select" aria-label="Language" value={language} onChange={(e) => setLanguage(e.target.value)}><option value="en">English</option><option value="hi">हिंदी</option><option value="mr">मराठी</option></select></div>{portal === "patient" && <div className="ob-sheet-row"><span>Text size</span><TextSizeControl size={textSize} setSize={setTextSize} /></div>}<div className="care-sheet-footer"><InstallButton /><button className="btn" onClick={logout}><LogOut size={17} />Sign out</button></div></Modal>}
      {searchOpen && <GlobalSearch nav={nav} patients={careTeam ? patients.data || [] : []} pid={pid} canDocs={can("documents")} onTab={change} onPatient={(id) => { setPid(id); setDocId(null); }} onOpenDoc={(id) => setDocId(Number(id))} onClose={() => setSearchOpen(false)} />}
      {phoneCheckin && <Modal title="Voice check-in" onClose={() => setPhoneCheckin(false)}><CheckIn pid={pid} language={language} phoneDemo onUpdate={() => setRevision(v => v + 1)} /></Modal>}
      {qr && (
        <QrScanner
          onClose={() => setQr(false)}
          onResult={(id) => {
            setQr(false);
            if (user.patient_ids.includes(id)) {
              setPid(id);
              setQrError("");
              toast(`Opened ${id}`);
              if (user.role === "doctor") change("clinic");
            } else
              setQrError(
                "This QR code belongs to a patient who isn't assigned to you.",
              );
          }}
        />
      )}
      {docId && <DocViewer docId={docId} onClose={() => setDocId(null)} />}
      {["patient", "doctor"].includes(portal) && can("documents") && pid && tab !== "companion" && <AIAssistantWidget pid={pid} language={language} onOpen={setDocId} userRole={user.role} />}
      <PrivacyCurtain on={privacyOn} onOff={() => setPrivacyOn(false)} />
      <Toaster />
    </div>
  );
}

export function SharedCard() {
  const { token } = useParams(),
    resource = useResource(`/shared/${token}`);
  return (
    <div className="care-shared-page">
      <Panel
        title="Shared care summary"
        hint="Only the details the patient chose to share appear here. This link expires and can be withdrawn."
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
