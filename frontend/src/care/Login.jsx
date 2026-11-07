import { useEffect, useState } from "react";
import { ArrowRight, Eye, EyeOff, HeartPulse, LockKeyhole, Stethoscope, Users, ChevronRight, ShieldCheck, Sparkles, CalendarCheck2, FileHeart, Activity } from "lucide-react";
import { useAuth } from "./Auth";
import { request } from "./client";
import { APP_TARGET } from "../deployment";
import Modal from "./Modal";

const portals = {
  patient: {
    label: "Patient", icon: HeartPulse, roles: ["patient", "caregiver"],
    headline: "Your cancer care, in one calm place.",
    lede: "Reports, medicines, appointments and your care team, together on your phone.",
    points: [[FileHeart, "Every report, explained simply"], [CalendarCheck2, "Appointments and reminders"], [ShieldCheck, "You control who sees what"]],
    heading: "Welcome back", sub: "Sign in to your care space.", id: "Patient or caregiver ID", placeholder: "OB-2026-0001", phone: "Registered mobile number",
  },
  doctor: {
    label: "Doctor", icon: Stethoscope, roles: ["doctor"],
    headline: "Walk into every consult prepared.",
    lede: "A cited one-page brief for each patient, built from their full record before you meet them.",
    points: [[Sparkles, "Pre-visit briefs with sources"], [Activity, "Lab trends and red flags first"], [CalendarCheck2, "Book follow-ups and video visits"]],
    heading: "Welcome back, Doctor", sub: "Sign in to your clinical workspace.", id: "Doctor ID", placeholder: "DOC-0001", phone: "Registered mobile number",
  },
  staff: {
    label: "Staff", icon: Users, roles: ["nurse", "lab", "frontdesk", "navigator", "dietitian", "privacy", "admin"],
    headline: "Run the hospital day without the chaos.",
    lede: "Check-ins, chairs, uploads, triage and handovers, coordinated in real time.",
    points: [[Activity, "Live triage and alerts"], [CalendarCheck2, "Schedules, chairs and queues"], [ShieldCheck, "Every access is logged"]],
    heading: "Good to see you", sub: "Sign in to your hospital workspace.", id: "Staff ID", placeholder: "STF-0002", phone: "Registered mobile number",
  },
};

const ROLE_LABEL = { patient: "Patient", caregiver: "Caregiver", doctor: "Medical oncologist", nurse: "Nurse", lab: "Laboratory", frontdesk: "Front desk", navigator: "Patient navigator", dietitian: "Dietitian", privacy: "Privacy officer", admin: "Administrator" };

export default function Login() {
  const { setUser } = useAuth();
  const routePortal = new URLSearchParams(window.location.search).get("portal")
    || window.location.pathname.match(/^\/(?:legacy\/)?(patient|doctor|staff)$/)?.[1];
  const initialPortal = APP_TARGET === "all" ? (portals[routePortal] ? routePortal : "patient") : APP_TARGET;
  const [portal, setPortal] = useState(initialPortal);
  const [config, setConfig] = useState(null), [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState(""), [totp, setTotp] = useState("");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [mode, setMode] = useState("id");
  const [challenge, setChallenge] = useState(null), [code, setCode] = useState("");
  const [showPassword, setShowPassword] = useState(false), [guestOpen, setGuestOpen] = useState(false), [helpOpen, setHelpOpen] = useState(false);
  const p = portals[portal] || portals.patient, Icon = p.icon;
  const guests = config?.accounts?.filter(a => p.roles.includes(a.role)) || [];
  useEffect(() => { request("/auth/config").then(setConfig).catch(() => setConfig({ demo: false, accounts: [] })); }, []);
  useEffect(() => { setIdentifier(""); setPassword(""); setTotp(""); setChallenge(null); setCode(""); setError(""); }, [portal, mode]);
  useEffect(() => { document.title = `Sign in · OncoBrief ${p.label}`; }, [p.label]);

  const submit = async e => {
    e.preventDefault(); setError(""); setBusy(true);
    try {
      if (portal === "patient" && mode === "phone") {
        if (!challenge) {
          const next = await request("/auth/otp", "POST", { phone: identifier.trim() });
          setChallenge(next);
          if (next.demo_code) setCode(next.demo_code);
        } else setUser(await request("/auth/verify-otp", "POST", { challenge_id: challenge.challenge_id, code }));
      } else setUser(await request("/auth/login", "POST", { username: identifier.trim(), password, totp, portal, identifier_type: mode }));
    } catch (err) { setError(err.message === "Invalid sign-in details" ? "That ID and password don't match. Check and try again." : err.message); }
    finally { setBusy(false); }
  };
  const guestSignIn = async account => {
    setBusy(true); setError("");
    try { setUser(await request("/auth/guest", "POST", { sign_in_id: account.sign_in_id, portal })); }
    catch (err) { setError(err.message); setGuestOpen(false); }
    finally { setBusy(false); }
  };

  return <div className={`ob-login portal-${portal}`}>
    <section className="ob-login-brand" aria-hidden="false">
      <div className="ob-login-logo"><span className="ob-mark"><HeartPulse size={20} strokeWidth={2.2} /></span>OncoBrief<span className="ob-login-edition">{p.label}</span></div>
      <div className="ob-login-hero">
        <h1>{p.headline}</h1>
        <p>{p.lede}</p>
        <ul>{p.points.map(([PointIcon, text]) => <li key={text}><span><PointIcon size={18} /></span>{text}</li>)}</ul>
      </div>
      <div className="ob-login-glow" aria-hidden="true" />
      <p className="ob-login-legal">© {new Date().getFullYear()} OncoBrief · Built in India for cancer care teams</p>
    </section>

    <section className="ob-login-panel">
      <div className="ob-login-card" key={portal}>
        <div className="ob-login-mobile-logo"><span className="ob-mark"><HeartPulse size={18} strokeWidth={2.2} /></span>OncoBrief</div>
        <span className="ob-login-icon"><Icon size={22} strokeWidth={1.8} /></span>
        <h2>{p.heading}</h2>
        <p className="ob-login-sub">{p.sub}</p>

        {APP_TARGET === "all" && <div className="ob-segment" role="tablist" aria-label="Choose your workspace">{Object.entries(portals).map(([key, value]) => <button key={key} role="tab" aria-selected={portal === key} className={portal === key ? "active" : ""} onClick={() => { setPortal(key); setMode("id"); }}>{value.label}</button>)}</div>}
        <div className="ob-segment" role="tablist" aria-label="Sign-in method">
          <button type="button" role="tab" aria-selected={mode === "id"} className={mode === "id" ? "active" : ""} onClick={() => setMode("id")}>{p.label} ID</button>
          <button type="button" role="tab" aria-selected={mode === "phone"} className={mode === "phone" ? "active" : ""} onClick={() => setMode("phone")}>Mobile number</button>
        </div>

        <form className="ob-login-form" onSubmit={submit}>
          <label className="ob-field"><span>{mode === "phone" ? p.phone : p.id}</span>
            <input required type={mode === "phone" ? "tel" : "text"} autoComplete={mode === "phone" ? "tel" : "username"} inputMode={mode === "phone" ? "tel" : "text"} placeholder={mode === "phone" ? "+91 98765 43210" : p.placeholder} value={identifier} onChange={e => { setIdentifier(mode === "phone" ? e.target.value.replace(/[^+0-9]/g, "") : e.target.value); setChallenge(null); setCode(""); }} />
          </label>
          {!(portal === "patient" && mode === "phone") && <>
            <label className="ob-field"><span>Password</span>
              <div className="ob-password"><input required type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
            </label>
            {config && !config.demo && portal !== "patient" && <label className="ob-field"><span>Authenticator code</span><input autoComplete="one-time-code" inputMode="numeric" placeholder="6-digit code" value={totp} onChange={e => setTotp(e.target.value)} /></label>}
          </>}
          {challenge && <label className="ob-field"><span>Verification code</span><input required pattern="[0-9]{6}" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6-digit code sent by SMS" value={code} onChange={e => setCode(e.target.value)} /><small>We sent a code to {identifier}. It expires in 5 minutes.</small></label>}
          {error && <p className="ob-login-error" role="alert">{error}</p>}
          <button className="ob-btn-primary" disabled={busy || !config}>{busy ? <span className="ob-spinner" aria-label="Signing in" /> : <>{portal === "patient" && mode === "phone" && !challenge ? "Send code" : "Sign in"}<ArrowRight size={18} /></>}</button>
        </form>

        {config?.demo && guests.length > 0 && <>
          <div className="ob-divider"><span>or</span></div>
          <button className="ob-btn-ghost" onClick={() => setGuestOpen(true)} disabled={busy}>Continue as guest</button>
        </>}

        <div className="ob-login-foot">
          <span><LockKeyhole size={13} /> Encrypted · Access is logged</span>
          <button type="button" onClick={() => setHelpOpen(true)}>Need help?</button>
        </div>
      </div>
    </section>

    {guestOpen && <Modal title="Choose a guest profile" onClose={() => setGuestOpen(false)}>
      <div className="ob-guest-list">{guests.map(a => <button key={a.sign_in_id} onClick={() => guestSignIn(a)} disabled={busy}>
        <span className="ob-guest-avatar">{a.name.replace(/^(Dr\.|Nurse|Reception|Navigator|Dietitian|Lab technician)\s*/i, "").slice(0, 1)}</span>
        <span className="ob-guest-text"><b>{a.name}</b><small>{ROLE_LABEL[a.role] || a.role} · {a.sign_in_id}</small></span>
        <ChevronRight size={18} />
      </button>)}</div>
    </Modal>}
    {helpOpen && <Modal title="Signing in" onClose={() => setHelpOpen(false)}>
      <div className="ob-help">
        {portal === "patient"
          ? <><p>Use the patient ID printed on your hospital card, or the mobile number registered at the front desk. We'll text you a one-time code.</p><p>Caregivers sign in with their own caregiver ID and password, given when the patient added them.</p></>
          : <><p>Use the ID issued by your hospital with your password. Staff accounts also need an authenticator code.</p><p>Forgot your password? Ask your hospital administrator to reset it.</p></>}
      </div>
    </Modal>}
  </div>;
}
