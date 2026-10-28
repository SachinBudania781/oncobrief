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
  ArrowRight,
  Search,
  Info,
  Ellipsis,
} from "lucide-react";
import Modal from "./Modal";
import { useAuth } from "./Auth";
import Login from "./Login";
import { request, useResource, dateTime, nice } from "./client";
import { ClinicDesk, StaffActivity } from "./DoctorStaffTools";
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
  const title = tab === "home" ? (portal === "patient" ? "Your care, connected." : portal === "doctor" ? "Your clinical workspace." : "Your hospital workspace.") : nav.find((n) => n[0] === tab)?.[1] |