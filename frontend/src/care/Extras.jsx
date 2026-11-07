import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Download, EyeOff, Info, MapPin, Phone, Siren, Type, WifiOff, X, Keyboard, HeartPulse, FileHeart, Pill, MessageCircle, ArrowRight } from "lucide-react";
import Modal from "./Modal";
import { request } from "./client";
import { toast } from "./toast";

const store = {
  get(key, fallback) { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } },
};

/* ---------- Toasts ---------- */
export function Toaster() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const add = (e) => {
      const item = e.detail;
      setItems((list) => [...list.slice(-2), item]);
      setTimeout(() => setItems((list) => list.filter((x) => x.id !== item.id)), 3800);
    };
    window.addEventListener("ob-toast", add);
    return () => window.removeEventListener("ob-toast", add);
  }, []);
  return createPortal(<div className="ob-toaster" role="status" aria-live="polite">{items.map((t) => <div key={t.id} className={`ob-toast tone-${t.tone}`}>{t.tone === "error" ? <AlertTriangle size={17} /> : t.tone === "info" ? <Info size={17} /> : <CheckCircle2 size={17} />}<span>{t.message}</span><button aria-label="Dismiss" onClick={() => setItems((l) => l.filter((x) => x.id !== t.id))}><X size={15} /></button></div>)}</div>, document.body);
}

/* ---------- Skeleton ---------- */
export function Skeleton({ lines = 3 }) {
  return <div className="ob-skeleton" aria-busy="true" aria-label="Loading">{Array.from({ length: lines }, (_, i) => <span key={i} style={{ width: `${92 - i * 14}%` }} />)}</div>;
}

/* ---------- Text size (accessibility) ---------- */
const SIZES = [["default", "A", 1], ["large", "A", 1.12], ["xlarge", "A", 1.25]];
export function useTextSize() {
  const [size, setSize] = useState(() => store.get("ob-text-size", "default"));
  useEffect(() => {
    const scale = SIZES.find((s) => s[0] === size)?.[2] || 1;
    document.documentElement.style.setProperty("--ob-text-scale", scale);
    document.documentElement.dataset.textSize = size;
    store.set("ob-text-size", size);
  }, [size]);
  return [size, setSize];
}
export function TextSizeControl({ size, setSize }) {
  return <div className="ob-textsize" role="radiogroup" aria-label="Text size">
    <Type size={16} aria-hidden="true" />
    {SIZES.map(([key, label, scale]) => <button key={key} role="radio" aria-checked={size === key} aria-label={`${key} text`} className={size === key ? "active" : ""} style={{ fontSize: `${13 * scale}px` }} onClick={() => setSize(key)}>{label}</button>)}
  </div>;
}

/* ---------- Privacy screen ---------- */
export function usePrivacyScreen() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const key = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "l") { e.preventDefault(); setOn((v) => !v); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => { document.documentElement.classList.toggle("ob-privacy-on", on); }, [on]);
  return [on, setOn];
}
export function PrivacyCurtain({ on, onOff }) {
  if (!on) return null;
  return createPortal(<button className="ob-privacy-curtain" onClick={onOff} aria-label="Privacy screen is on. Click to show the workspace again.">
    <span className="ob-privacy-badge"><EyeOff size={26} /></span>
    <b>Privacy screen on</b>
    <small>Patient details are hidden. Click anywhere or press Ctrl + Shift + L to continue.</small>
  </button>, document.body);
}

/* ---------- Connectivity ---------- */
export function OfflineBanner() {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const up = () => { setOnline(true); toast("Back online", "info"); };
    const down = () => setOnline(false);
    window.addEventListener("online", up); window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);
  return online ? null : <div className="ob-offline" role="alert"><WifiOff size={16} />You're offline. Changes will fail until your connection returns.</div>;
}

/* ---------- Install as app ---------- */
export function useInstallPrompt() {
  const [event, setEvent] = useState(null);
  const [installed, setInstalled] = useState(() => window.matchMedia?.("(display-mode: standalone)").matches);
  useEffect(() => {
    const before = (e) => { e.preventDefault(); setEvent(e); };
    const done = () => { setInstalled(true); setEvent(null); toast("OncoBrief installed on this device"); };
    window.addEventListener("beforeinstallprompt", before); window.addEventListener("appinstalled", done);
    return () => { window.removeEventListener("beforeinstallprompt", before); window.removeEventListener("appinstalled", done); };
  }, []);
  const install = async () => { if (!event) return; event.prompt(); await event.userChoice.catch(() => null); setEvent(null); };
  return { canInstall: Boolean(event) && !installed, install };
}
export function InstallButton({ compact = false }) {
  const { canInstall, install } = useInstallPrompt();
  if (!canInstall) return null;
  return <button className={compact ? "btn icon-btn" : "btn ob-install"} onClick={install} aria-label="Install app"><Download size={16} />{!compact && <span>Install app</span>}</button>;
}

/* ---------- Emergency SOS (patients) ---------- */
export function SosButton({ pid, emergencyPhone }) {
  const [open, setOpen] = useState(false), [state, setState] = useState(""), [location, setLocation] = useState(null);
  const phone = emergencyPhone || "108";
  const alertTeam = async () => {
    setState("sending");
    let where = "";
    try {
      const pos = await new Promise((res, rej) => navigator.geolocation ? navigator.geolocation.getCurrentPosition(res, rej, { timeout: 6000, maximumAge: 60000 }) : rej());
      where = ` Location: https://maps.google.com/?q=${pos.coords.latitude.toFixed(5)},${pos.coords.longitude.toFixed(5)}`;
      setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    } catch { /* location optional */ }
    try {
      await request(`/v2/patients/${pid}/sos`, "POST", { note: `Patient pressed SOS in the app.${where}` });
      setState("sent"); toast("Your care team has been alerted");
    } catch (e) { setState(""); toast(e.message, "error"); }
  };
  return <>
    <button className="ob-sos" onClick={() => setOpen(true)} aria-label="Emergency help"><Siren size={18} /><span>SOS</span></button>
    {open && <Modal title="Emergency help" onClose={() => { setOpen(false); setState(""); }}>
      <div className="ob-sos-sheet">
        <p>If you feel very unwell, such as fever above 38°C, trouble breathing, heavy bleeding, chest pain or confusion, get help now.</p>
        <a className="ob-sos-call" href={`tel:${phone.replace(/\s/g, "")}`}><Phone size={20} />Call {emergencyPhone ? "the hospital emergency line" : "ambulance (108)"}</a>
        <button className="ob-sos-alert" onClick={alertTeam} disabled={state === "sending" || state === "sent"}>
          {state === "sent" ? <><CheckCircle2 size={19} />Care team alerted</> : state === "sending" ? "Alerting your care team…" : <><Siren size={19} />Alert my care team now</>}
        </button>
        {state === "sent" && <p className="ob-sos-note">The on-duty team can see your alert{location ? " and your current location" : ""}. Keep your phone close.</p>}
        {location && <a className="ob-sos-map" href={`https://maps.google.com/?q=${location.lat},${location.lng}`} target="_blank" rel="noreferrer"><MapPin size={15} />Shared location</a>}
      </div>
    </Modal>}
  </>;
}

/* ---------- Keyboard shortcuts ---------- */
export function ShortcutsHelp({ portal }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const key = (e) => {
      const typing = /input|textarea|select/i.test(e.target.tagName) || e.target.isContentEditable;
      if (!typing && e.key === "?" ) { e.preventDefault(); setOpen((v) => !v); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  if (!open) return null;
  const mod = navigator.platform?.includes("Mac") ? "⌘" : "Ctrl";
  const rows = [[`${mod} K`, "Search patients, records and pages"], ["?", "Show this list"], ["Esc", "Close a window"]];
  if (portal !== "patient") rows.splice(1, 0, [`${mod} Shift L`, "Privacy screen: hide patient details"], ["G then H", "Go to home"], ["N", "Open notifications"]);
  return <Modal title="Keyboard shortcuts" onClose={() => setOpen(false)}>
    <div className="ob-shortcuts"><Keyboard size={20} aria-hidden="true" />{rows.map(([k, label]) => <div key={k}><span>{label}</span><kbd>{k}</kbd></div>)}</div>
  </Modal>;
}

/* ---------- First-run welcome (patients) ---------- */
const TOUR = [
  [HeartPulse, "Tell us how you feel", "A 30-second daily check-in lets your team spot problems early."],
  [Pill, "Never miss a dose", "See today's medicines and tick them off with one tap."],
  [FileHeart, "All your reports, explained", "Upload a photo of any report. We file it and explain it simply."],
  [MessageCircle, "Ask anything", "Ask the assistant about your reports, or message your care circle."],
];
export function WelcomeTour({ name }) {
  const [step, setStep] = useState(0), [open, setOpen] = useState(() => !store.get("ob-welcome-done", false));
  if (!open) return null;
  const [Icon, title, body] = TOUR[step];
  const finish = () => { store.set("ob-welcome-done", true); setOpen(false); };
  return <Modal title={step === 0 ? `Welcome${name ? `, ${name}` : ""}` : "Getting started"} onClose={finish} className="ob-tour-modal">
    <div className="ob-tour">
      <span className="ob-tour-icon"><Icon size={30} strokeWidth={1.6} /></span>
      <h3>{title}</h3><p>{body}</p>
      <div className="ob-tour-dots">{TOUR.map((_, i) => <i key={i} className={i === step ? "active" : ""} />)}</div>
      <div className="ob-tour-actions">
        <button className="btn" onClick={finish}>Skip</button>
        <button className="btn primary" onClick={() => step === TOUR.length - 1 ? finish() : setStep(step + 1)}>{step === TOUR.length - 1 ? "Get started" : "Next"}<ArrowRight size={16} /></button>
      </div>
    </div>
  </Modal>;
}

/* ---------- Global search ---------- */
export function GlobalSearch({ nav, patients = [], pid, onTab, onPatient, onOpenDoc, onClose, canDocs }) {
  const [query, setQuery] = useState(""), [docs, setDocs] = useState([]), [active, setActive] = useState(0);
  useEffect(() => {
    if (!canDocs || query.trim().length < 2 || !pid) { setDocs([]); return; }
    const t = setTimeout(() => request(`/patients/${pid}/documents?q=${encodeURIComponent(query.trim())}`).then((d) => setDocs(d.slice(0, 6))).catch(() => setDocs([])), 220);
    return () => clearTimeout(t);
  }, [query, pid, canDocs]);
  const q = query.toLowerCase().trim();
  const results = useMemo(() => [
    ...patients.filter((p) => q && (p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q))).slice(0, 5).map((p) => ({ key: "p" + p.id, group: "Patients", label: p.name, sub: `${p.id}${p.cancer_type ? " · " + p.cancer_type : ""}`, run: () => onPatient(p.id) })),
    ...docs.map((d) => ({ key: "d" + d.id, group: "Records", label: d.title || d.subtype || "Document", sub: [d.category, d.record_date].filter(Boolean).join(" · "), run: () => onOpenDoc(d.id) })),
    ...nav.filter(([, label]) => !q || label.toLowerCase().includes(q)).slice(0, q ? 6 : 8).map(([key, label, Icon]) => ({ key: "n" + key, group: "Go to", label, Icon, run: () => onTab(key) })),
  ], [q, patients, docs, nav]);
  useEffect(() => setActive(0), [q, docs.length]);
  const choose = (r) => { r.run(); onClose(); };
  let lastGroup = "";
  return <Modal title="Search" onClose={onClose} className="ob-search-modal">
    <input className="input ob-search-input" type="search" data-autofocus placeholder={patients.length > 1 ? "Search patients, reports or pages…" : "Search reports or pages…"} value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search"
      onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); } if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); } if (e.key === "Enter" && results[active]) choose(results[active]); }} />
    <div className="ob-search-results" role="listbox">
      {results.map((r, i) => { const head = r.group !== lastGroup; lastGroup = r.group; return <div key={r.key}>{head && <p className="ob-search-group">{r.group}</p>}
        <button role="option" aria-selected={i === active} className={i === active ? "active" : ""} onMouseEnter={() => setActive(i)} onClick={() => choose(r)}>{r.Icon ? <r.Icon size={17} /> : <span className="ob-search-dot">{r.label.slice(0, 1)}</span>}<span><b>{r.label}</b>{r.sub && <small>{r.sub}</small>}</span></button></div>; })}
      {!results.length && <p className="ob-search-empty">No matches for “{query}”.</p>}
    </div>
  </Modal>;
}
