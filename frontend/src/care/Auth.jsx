import { createContext, useContext, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { request } from "./client";
import { APP } from "../deployment";

const Context = createContext(null);
export const useAuth = () => useContext(Context);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    request("/auth/me")
      .then(async account => {
        if (APP.roles && !APP.roles.includes(account.role)) {
          await request("/auth/logout", "POST");
          return;
        }
        setUser(account);
      })
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
