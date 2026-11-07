import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, HeartPulse, LockKeyhole } from "lucide-react";
import { useAuth } from "./Auth";
import { request } from "./client";
import { APP_TARGET } from "../deployment";
import { Aurora, GlassCross, GlassOrb, useTilt } from "./Glass3D";

const portals = {
  patient: {
    label: "Patient", hue: "blue", roles: ["patient", "caregiver"],
    headline: ["Your care,", "made simple."],
    lede: "Reports, medicines, visits and your care team. One calm place, in your language.",
    heading: "Welcome back", sub: "Sign in to your care space", id: "Patient or caregiver ID", placeholder: "OB-2026-0001",
  },
  doctor: {
    label: "Doctor", hue: "violet", roles: ["doctor"],
    headline: ["Every consult,", "fully prepared."],
    lede: "Cited pre-visit briefs, live consult notes and one-tap follow-ups, built from the full record.",
    heading: "Welcome back, Doctor", sub: "Sign in to your clinical workspace", id: "Doctor ID", placeholder: "DOC-0001",
  },
  staff: {
    label: "Staff", hue: "teal", roles: ["nurse", "lab", "frontdesk", "navigator", "dietitian", "privacy", "admin"],
    headline: ["The hospital day,", "in flow."],
    lede: "Check-ins, chairs, uploads, triage and handovers, coordinated in real time.",
    heading: "Good to see you", sub: "Sign in to your hospital workspace", id: "Staff ID", placeholder: "STF-0002",
  },
};

const seen = () => { try { return localStorage.getItem("ob-splash-seen") === "1"; } catch { return true; } };

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
  const [showPassword, setShowPassword] = useState(false);
  const [screen, setScreen] = useState(() => (seen() ? "signin" : "splash"));
  const p = portals[portal] || portals.patient;
  const tilt = useTilt(10);
  useEffect(() => { request("/auth/config").then(setConfig).catch(() => setConfig({ demo: false })); }, []);
  useEffect(() => { setIdentifier(""); setPassword(""); setTotp(""); setChallenge(null); setCode(""); setError(""); }, [portal, mode]);
  useEffect(() => { document.title = `Sign in · OncoBrief ${p.label}`; }, [p.label]);
  const start = () => { try { localStorage.setItem("ob-splash-seen", "1"); } catch { /* ignore */ } setScreen("signin"); };

  const submit = async (e) => {
    e.preventDefault(); setError(""); setBusy(true);
    try {
      if (portal === "patient" && mode === "phone") {
        if (!challenge) {
          const next = await request("/auth/otp", "POST", { phone: identifier.trim() });
          setChallenge(next);
          if (next.demo_code) setCode(next.demo_code);
        } else setUser(await request("/auth/verify-otp", "POST", { challenge_id: challenge.challenge_id, code }));
      } else setUser(await request("/auth/login", "POST", { username: identifier.trim(), password, totp, portal, identifier_type: mode }));
    } catch (err) { setError(err.message === "Invalid sign-in details" ? "That ID and password don't match." : err.message); }
    finally { setBusy(false); }
  };

  return <div className={`ob-login2 portal-${portal} screen-${screen}`}>
    <Aurora tone={portal} />
    <section className="ob-login2-hero" ref={tilt}>
      <div className="ob-login2-brand"><span className="ob-mark"><HeartPulse size={18} strokeWidth={2.4} /></span>OncoBrief</div>
      <div className="ob-login2-art">
        <GlassCross size={300} hue={p.hue} />
        <GlassOrb size={70} className="ob-login2-moon" colors={portal === "doctor" ? ["#f3d9ff", "#a77bff", "#5b3fe0"] : portal === "staff" ? ["#d9fff6", "#3fd0b8", "#0f7f8a"] : ["#ffe3f1", "#ff9ccf", "#a66bff"]} />
      </div>
      <div className="ob-login2-copy">
        <h1>{p.headline[0]}<br /><span>{p.headline[1]}</span></h1>
        <p>{p.lede}</p>
      </div>
      <button className="ob-cta ob-login2-start" onClick={start}>Get started<span><ArrowRight size={18} /></span></button>
    </section>

    <section className="ob-login2-panel">
      {screen === "forgot" ? <Forgot portal={portal} p={p} onBack={() => setScreen("signin")} /> : <div className="ob-login2-card" key={portal}>
        <button className="ob-back ob-login2-backsplash" onClick={() => setScreen("splash")} aria-label="Back"><ArrowLeft size={18} /></button>
        <h2>{p.heading}</h2>
        <p className="ob-login2-sub">{p.sub}</p>
        {APP_TARGET === "all" && <div className="ob-segment" role="tablist" aria-label="Choose your workspace">{Object.entries(portals).map(([key, value]) => <button key={key} role="tab" aria-selected={portal === key} className={portal === key ? "active" : ""} onClick={() => { setPortal(key); setMode("id"); }}>{value.label}</button>)}</div>}
        <div className="ob-segment" role="tablist" aria-label="Sign-in method">
          <button type="button" role="tab" aria-selected={mode === "id"} className={mode === "id" ? "active" : ""} onClick={() => setMode("id")}>{p.label} ID</button>
          <button type="button" role="tab" aria-selected={mode === "phone"} className={mode === "phone" ? "active" : ""} onClick={() => setMode("phone")}>Mobile number</button>
        </div>
        <form className="ob-login-form" onSubmit={submit}>
          <label className="ob-field"><span>{mode === "phone" ? "Registered mobile number" : p.id}</span>
            <input required type={mode === "phone" ? "tel" : "text"} autoComplete={mode === "phone" ? "tel" : "username"} inputMode={mode === "phone" ? "tel" : "text"} placeholder={mode === "phone" ? "+91 98765 43210" : p.placeholder} value={identifier} onChange={(e) => { setIdentifier(mode === "phone" ? e.target.value.replace(/[^+0-9]/g, "") : e.target.value); setChallenge(null); setCode(""); }} />
          </label>
          {!(portal === "patient" && mode === "phone") && <>
            <label className="ob-field"><span className="ob-field-row">Password<button type="button" className="ob-textlink" onClick={() => setScreen("forgot")}>Forgot password?</button></span>
              <div className="ob-password"><input required type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)} /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
            </label>
            {config && !config.demo && portal !== "patient" && <label className="ob-field"><span>Authenticator code</span><input autoComplete="one-time-code" inputMode="numeric" placeholder="6-digit code" value={totp} onChange={(e) => setTotp(e.target.value)} /></label>}
          </>}
          {challenge && <label className="ob-field"><span>Verification code</span><input required pattern="[0-9]{6}" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} /><small>Sent by SMS to {identifier}. It expires in 5 minutes.</small></label>}
          {error && <p className="ob-login-error" role="alert">{error}</p>}
          <button className="ob-cta" disabled={busy || !config}>{busy ? <span className="ob-spinner" aria-label="Signing in" /> : <>{portal === "patient" && mode === "phone" && !challenge ? "Send code" : "Sign in"}<span><ArrowRight size={18} /></span></>}</button>
        </form>
        <p className="ob-login2-foot"><LockKeyhole size={13} />End-to-end encrypted · Every access is logged</p>
      </div>}
    </section>
  </div>;
}

function Forgot({ p, onBack }) {
  const [step, setStep] = useState("ask"), [identifier, setIdentifier] = useState(""), [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState(""), [pw, setPw] = useState(""), [pw2, setPw2] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const send = async (e) => {
    e.preventDefault(); setBusy(true); setError("");
    try { const r = await request("/auth/forgot", "POST", { identifier: identifier.trim() }); setChallenge(r); if (r.demo_code) setCode(r.demo_code); setStep("code"); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const reset = async (e) => {
    e.preventDefault(); setError("");
    if (pw !== pw2) { setError("The two passwords don't match."); return; }
    setBusy(true);
    try { await request("/auth/reset", "POST", { challenge_id: challenge.challenge_id, code, new_password: pw }); setStep("done"); }
    catch (err) { setError(err.message === "Code expired or invalid" ? "That code is wrong or has expired. Request a new one." : err.message); } finally { setBusy(false); }
  };
  return <div className="ob-login2-card">
    <button className="ob-back" onClick={onBack} aria-label="Back to sign in"><ArrowLeft size={18} /></button>
    {step === "done" ? <div className="ob-login2-done">
      <span className="ob-done-badge"><Check size={26} /></span>
      <h2>Password updated</h2>
      <p className="ob-login2-sub">You've been signed out of other devices. Sign in with your new password.</p>
      <button className="ob-cta" onClick={onBack}>Back to sign in<span><ArrowRight size={18} /></span></button>
    </div> : <>
      <h2>{step === "ask" ? "Reset your password" : "Create a new password"}</h2>
      <p className="ob-login2-sub">{step === "ask" ? "Enter your ID or registered mobile number. We'll text you a code." : challenge?.sent_to ? `Enter the code we sent to ${challenge.sent_to}.` : "If that account exists, we've sent a code to its registered mobile number."}</p>
      {step === "ask" ? <form className="ob-login-form" onSubmit={send}>
        <label className="ob-field"><span>{p.id} or mobile number</span><input required autoComplete="username" placeholder={p.placeholder} value={identifier} onChange={(e) => setIdentifier(e.target.value)} /></label>
        {error && <p className="ob-login-error" role="alert">{error}</p>}
        <button className="ob-cta" disabled={busy}>{busy ? <span className="ob-spinner" /> : <>Send code<span><ArrowRight size={18} /></span></>}</button>
      </form> : <form className="ob-login-form" onSubmit={reset}>
        <label className="ob-field"><span>6-digit code</span><input required pattern="[0-9]{6}" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} placeholder="••••••" /></label>
        <label className="ob-field"><span>New password</span><input required type="password" minLength={8} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="At least 8 characters, with a number" /></label>
        <label className="ob-field"><span>Confirm new password</span><input required type="password" minLength={8} autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
        {error && <p className="ob-login-error" role="alert">{error}</p>}
        <button className="ob-cta" disabled={busy}>{busy ? <span className="ob-spinner" /> : <>Update password<span><ArrowRight size={18} /></span></>}</button>
        <button type="button" className="ob-textlink center" onClick={() => { setStep("ask"); setCode(""); }}>Didn't get a code? Send again</button>
      </form>}
    </>}
  </div>;
}
