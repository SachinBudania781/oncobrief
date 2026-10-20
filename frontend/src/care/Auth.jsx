import { createContext, useContext, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { ShieldCheck, ArrowRight, HeartPulse } from "lucide-react";
import { request } from "./client";
import { APP, APP_TARGET, appAccounts } from "../deployment";

const Context = createContext(null);
export const useAuth = () => useContext(Context);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    request("/auth/me")
      .then(setUser)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    const expired = () => setUser(null);
    window.addEventListener("ob-session-expired", expired);
    return () => window.removeEventListener("ob-session-expired", expired);
  }, []);
  useEffect(() => {
    if (!user) return;
    let timer;
    const idleMinutes = user.idle_minutes || 30;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        request("/auth/logout", "POST").catch(() => {});
        setUser(null);
      }, idleMinutes * 60000);
    };
    reset();
    for (const event of ["pointerdown", "keydown", "touchstart"])
      window.addEventListener(event, reset);
    return () => {
      clearTimeout(timer);
      for (const event of ["pointerdown", "keydown", "touchstart"])
        window.removeEventListener(event, reset);
    };
  }, [user]);
  const logout = async () => {
    try {
      await request("/auth/logout", "POST");
    } finally {
      setUser(null);
    }
  };
  return (
    <Context.Provider value={{ user, setUser, logout, loading }}>
      {children}
    </Context.Provider>
  );
}

export function LegacyGuard({ children, roles }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="care-loading">Checking your session…</p>;
  return user && roles.includes(user.role) ? (
    children
  ) : (
    <Navigate to="/app" replace />
  );
}

export function Login() {
  const { setUser } = useAuth();
  const [config, setConfig] = useState(null);
  const [username, setUsername] = useState("doctor");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState("password");
  const [phone, setPhone] = useState("");
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState("");
  useEffect(() => {
    request("/auth/config")
      .then((c) => {
        const accounts = appAccounts(c.accounts || []);
        setConfig({ ...c, accounts });
        if (c.demo) {
          setPassword(c.demo_password);
          if (accounts.length) setUsername(accounts[0].username);
        }
      })
      .catch((e) => setError(e.message));
  }, []);
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "otp" && !challenge)
        setChallenge(await request("/auth/otp", "POST", { phone }));
      else
        setUser(
          await request(
            mode === "otp" ? "/auth/verify-otp" : "/auth/login",
            "POST",
            mode === "otp"
              ? { challenge_id: challenge.challenge_id, code }
              : { username, password, totp },
          ),
        );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="care-login">
      <section className="login-story">
        <div className="care-logo">
          <HeartPulse /> OncoBrief <span>ROUND 2</span>
        </div>
        <div>
          <p className="eyebrow">CARE THAT STAYS CONNECTED</p>
          <h1>
            Your whole care team.
            <br />
            One shared story.
          </h1>
          <p>
            From a one-minute check-in at home to a signed plan at the clinic,
            keep the next step clear.
          </p>
          <div className="login-proof">
            <ShieldCheck />
            <span>
              Personal records. Patient consent.
              <br />A doctor signs every clinical decision.
            </span>
          </div>
        </div>
        <small>Team TripleT · Cancer care</small>
      </section>
      <section className="login-panel">
        <div className="login-form">
          <span className="care-pill">WELCOME BACK</span>
          <h2>{APP_TARGET === "all" ? "Sign in to your care space" : `Sign in to ${APP.name}`}</h2>
          <p className="muted">
            Use your own account to see the patients and information shared with
            you.
          </p>
          {config?.demo && (
            <div className="care-notice">
              Demo environment · all patients are fabricated.
              <br />
              Demo password: <b>{config.demo_password}</b>
            </div>
          )}
          <div className="care-segment">
            <button
              onClick={() => setMode("password")}
              className={mode === "password" ? "active" : ""}
            >
              Staff / caregiver
            </button>
            <button
              onClick={() => setMode("otp")}
              className={mode === "otp" ? "active" : ""}
            >
              Patient phone OTP
            </button>
          </div>
          <form onSubmit={submit} className="stack">
            {mode === "password" ? (
              <>
                {config?.demo ? (
                  <label className="field">
                    Demo account
                    <select
                      className="select"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                    >
                      {config.accounts.map((a) => (
                        <option key={a.username} value={a.username}>
                          {a.name} · {a.role}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label className="field">
                    Username
                    <input
                      className="input"
                      required
                      autoComplete="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                    />
                  </label>
                )}
                <label className="field">
                  Password
                  <input
                    className="input"
                    type="password"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                {!config?.demo && (
                  <label className="field">
                    Authenticator code
                    <input
                      className="input"
                      value={totp}
                      onChange={(e) => setTotp(e.target.value)}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                    />
                  </label>
                )}
              </>
            ) : (
              <>
                <label className="field">
                  Registered phone number
                  <input
                    className="input"
                    required
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91…"
                  />
                </label>
                {challenge && (
                  <>
                    <p>{challenge.message}</p>
                    {challenge.demo_code && (
                      <p className="care-notice">
                        Demo code: {challenge.demo_code}
                      </p>
                    )}
                    <label className="field">
                      Six-digit code
                      <input
                        className="input"
                        pattern="[0-9]{6}"
                        required
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        autoComplete="one-time-code"
                      />
                    </label>
                  </>
                )}
              </>
            )}
            {error && (
              <p className="care-error" role="alert">
                {error}
              </p>
            )}
            <button className="btn primary lg" disabled={busy || !config}>
              {busy
                ? "Please wait…"
                : mode === "otp" && !challenge
                  ? "Send code"
                  : "Open my care space"}
              <ArrowRight size={17} />
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
