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
import DoctorApp from "./apps/doctor/DoctorApp";
import StaffApp from "./apps/staff/StaffApp";
import PatientApp from "./apps/patient/PatientApp";
import Workspace, { SharedCard } from "./care/Workspace";
import { AuthProvider, LegacyGuard } from "./care/Auth";
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
          <Route
            path="/legacy/doctor"
            element={
              <LegacyGuard roles={["doctor"]}>
                <DoctorApp />
              </LegacyGuard>
            }
          />
          <Route
            path="/legacy/staff"
            element={
              <LegacyGuard roles={["nurse", "lab", "frontdesk", "admin"]}>
                <StaffApp />
              </LegacyGuard>
            }
          />
          <Route
            path="/legacy/patient"
            element={
              <LegacyGuard roles={["patient", "caregiver"]}>
                <PatientApp />
              </LegacyGuard>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
