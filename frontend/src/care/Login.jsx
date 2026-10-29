import { useEffect, useState } from "react";
import { ArrowRight, ArrowUpRight, HeartPulse, ShieldCheck, Stethoscope, Users, Eye, EyeOff, Info, LockKeyhole } from "lucide-react";
import { useAuth } from "./Auth";
import { request } from "./client";
import { APP_TARGET } from "../deployment";
import Modal from "./Modal";

const portals = {
  patient: { label: "Patient", eyebrow: "YOUR CARE, CONNECTED", title: <>A little clarity.<br />A better day.</>, description: "Your care team, records and next steps. All a little closer.", heading: "Your care starts here.", sub: "Sign in to your personal care space.", id: "Patient or caregiver ID", placeholder: "OB-2026-0001", phone: "Patient phone number", icon: HeartPulse, roles: ["patient", "caregiver"] },
  doctor: { label: "Doctor", eyebrow: "MORE TIME FOR CARE", title: <>The whole picture.<br />At a glance.</>, description: "Every patient story, brought together for the decisions that matter.", heading: "Welcome back, Doctor.", sub: "Your clinical workspace is ready.", id: "Doctor ID", placeholder: "DOC-0001", phone: "Doctor phone number", icon: Stethoscope, roles: ["doctor"] },
  staff: { label: "Staff", eyebrow: "BETTER DAYS, TOGETHER", title: <>Every detail.<br />In good hands.</>, description: "A connected hospital day. From the first check-in to the next handover.", heading: "Ready for a better day?", sub: "Sign in to your hospital workspace.", id: "Staff ID", placeholder: "STF-0002", phone: "Staff phone number", icon: Users, roles: ["nurse", "lab", "frontdesk", "navigator", "dietitian", "privacy", "admin"] },
};

export default function Login() {
  const { setUser } = useAuth();
  const routePortal = new URLSearchParams(window.location.search).get("portal")
    || window.location.pathname.match(/^\/legacy\/(patient|doctor|staff)$/)?.[1];
  const initialPortal = APP_TARGET === "all"
    ? (portals[routePortal] ? routePortal : "patient")
    : APP_TARGET;
  const [portal, setPortal] = useState(initialPortal);
  const [config, setConfig] = useState(null), [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState(""), [totp, setTotp] = useState("");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [mode, setMode] = useState("id");
  const [challenge, setChallenge] = useState(null), [code, setCode] = useState("");
  const [showPassword, setShowPassword] = useState(false), [about, setAbout] = useState(false);
  const p = portals[portal] || portals.patient, Icon = p.icon;
  const accounts = config?.accounts?.filter(a => p.roles.includes(a.role)) || [];
  useEffect(() => { request("/auth/config").then(setConfig).catch(e => setError(e.message)); }, []);
  useEffect(() => { setIdentifier(""); setPassword(""); setTotp(""); setChallenge(null); setCode(""); setError(""); }, [portal, mode]);
  const chooseAccount = a => { setIdentifier(mode === "phone" ? a.phone || "" : a.sign_in_id); setPassword(config.demo_password); setChallenge(null); setCode(""); setAbout(false); };
  const submit = async e => {
    e.preventDefault(); setError(""); setBusy(true);
    try {
      if (portal === "patient" && mode === "phone") {
        if (!challenge) setChallenge(await request("/auth/otp", "POST", { phone: identifier.trim() }));
        else setUser(await request("/auth/verify-otp", "POST", { challenge_id: challenge.challenge_id, code }));
      } else setUser(await request("/auth/login", "POST", { username: identifier.trim(), password, totp, portal, identifier_type: mode }));
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return <div className={`care-login portal-${portal}`}>
    <section className="login-story">
      <div className="care-logo"><span className="care-brand-mark"><HeartPulse size={23} /></span>OncoBrief<span className="care-brand-edition">{p.label}</span></div>
      <div className="login-story-main"><p className="eyebrow">{p.eyebrow}</p><h1>{p.title}</h1><p>{p.description}</p>
        <div className="login-orbit" aria-hidden="true"><div className="orbit-ring orbit-one" /><div className="orbit-ring orbit-two" /><div className="orbit-core"><Icon size={52} strokeWidth={1.3} /></div><div className="orbit-label"><span className="care-connection-dot" />Care that stays connected</div><div className="orbit-chip"><ShieldCheck size={17} />One connected story</div></div>
      </div>
      <div className="login-story-foot"><span>Connected cancer care</span><span>Designed around you <ArrowUpRight size={15} /></span></div>
    </section>
    <section className="login-panel">
      <div className="login-mobile-brand care-logo"><span className="care-brand-mark"><HeartPulse size={22} /></span>OncoBrief<span className="care-brand-edition">{p.label}</span></div>
      <button className="login-about" onClick={() => setAbout(true)}><Info size={17} />Workspace information</button>
      <div className="login-form" key={portal}>
        <div className="login-portal-icon"><Icon size={27} strokeWidth={1.6} /></div><p className="eyebrow">ONCOBRIEF / {p.label.toUpperCase()}</p><h2>{p.heading}</h2><p className="muted">{p.sub}</p>
        {APP_TARGET === "all" && <div className="care-segment portal-picker" aria-label="Choose your workspace">{Object.entries(portals).map(([key, value]) => <button key={key} className={portal === key ? "active" : ""} onClick={() => { setPortal(key); setMode("id"); }}>{value.label}</button>)}</div>}
        <div className="care-segment" aria-label="Sign-in method"><button type="button" aria-pressed={mode === "id"} className={mode === "id" ? "active" : ""} onClick={() => setMode("id")}>{p.label} ID</button><button type="button" aria-pressed={mode === "phone"} className={mode === "phone" ? "active" : ""} onClick={() => setMode("phone")}>Phone number</button></div>
        <form className="stack" onSubmit={submit}>
          <label className="field"><span>{mode === "phone" ? p.phone : p.id}</span><input className="input" required type={mode === "phone" ? "tel" : "text"} autoComplete={mode === "phone" ? "tel" : "username"} placeholder={mode === "phone" ? "+91 00000 00000" : p.placeholder} value={identifier} onChange={e => { setIdentifier(mode === "phone" ? e.target.value.replace(/[^+0-9]/g, "") : e.target.value); setChallenge(null); setCode(""); }} /></label>
          {!(portal === "patient" && mode === "phone") && <>
            <label className="field"><span>Password</span><div className="login-password"><input className="input" required type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="Enter your password" value={password} onChange={e => setPassword(e.target.value)} /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>
            {!config?.demo && portal !== "patient" && <label className="field"><span>Authenticator code</span><input className="input" autoComplete="one-time-code" inputMode="numeric" value={totp} onChange={e => setTotp(e.target.value)} /></label>}
          </>}
          {challenge && <><p className="small muted">{challenge.message}</p>{challenge.demo_code && <p className="care-notice">Test verification code: <b>{challenge.demo_code}</b></p>}<label className="field"><span>Six-digit code</span><input className="input" required pattern="[0-9]{6}" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value)} /></label></>}
          {error && <p className="care-error" role="alert">{error}</p>}
          <button className="btn primary lg login-submit" disabled={busy || !config}>{busy ? "Connecting…" : portal === "patient" && mode === "phone" && !challenge ? "Send verification code" : `Enter ${p.label.toLowerCase()} workspace`}<ArrowRight size={18} /></button>
        </form>
        <div className="login-secure"><LockKeyhole size={14} /><span>Your space. Your information.</span></div>
        {config?.demo && <button className="login-demo-link" onClick={() => setAbout(true)}>Use a hackathon test account <ArrowUpRight size={14} /></button>}
      </div>
      <footer className="login-footer">OncoBrief <span>Thoughtful care, every day.</span></footer>
    </section>
    {about && <Modal title={`${p.label} workspace`} onClose={() => setAbout(false)}><div className="care-information"><p>Only information assigned or shared with your account is available. Clinical decisions remain with the treating team.</p>{config?.demo && <><div className="care-notice"><b>Hackathon workspace</b><p>Patients, reports and phone numbers are fabricated. Do not upload real patient information. Test password: <b>{config.demo_password}</b></p></div><p className="small muted">Choose an ID to fill the sign-in form.</p><div className="login-demo-accounts">{accounts.map(a => <button key={a.username} onClick={() => chooseAccount(a)}><span><b>{a.sign_in_id}</b><small>{a.name} · {a.role}</small></span><ArrowRight size={17} /></button>)}</div></>}<p className="small muted">{portal === "patient" ? "Patients use their hospital patient ID or registered phone. Caregivers use their own caregiver ID and password. Outside the test workspace, patients sign in with phone verification." : "Use your issued hospital ID or registered phone with your password. Hospital staff also need an authenticator code outside the test workspace."}</p></div></Modal>}
  </div>;
}
