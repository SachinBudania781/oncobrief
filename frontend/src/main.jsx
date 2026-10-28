import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/ibm-plex-sans-devanagari/400.css";
import "@fontsource/ibm-plex-sans-devanagari/600.css";
import "./styles.css";
import Landing from "./pages/Landing";
import Workspace, { SharedCard } from "./care/Workspace";
import TransportTracker from "./care/TransportTracker";
import { AuthProvider } from "./care/Auth";
import { APP_TARGET } from "./deployment";

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("Phone installation support could not start", error);
    });
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={APP_TARGET === "all" ? <Landing /> : <Workspace />} />
          <Route path="/app" element={<Workspace />} />
          <Route path="/doctor" element={<Workspace />} />
          <Route path="/staff" element={<Workspace />} />
          <Route path="/patient" element={<Workspace />} />
          <Route path="/caregiver" element={<Workspace />} />
          <Route path="/share/:token" element={<SharedCard />} />
          <Route path="/transport-track/:token" element={<TransportTracker />} />
          <Route path="/legacy/doctor" element={<Navigate to="/doctor" replace />} />
          <Route path="/legacy/staff" element={<Navigate to="/staff" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);

