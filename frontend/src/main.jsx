import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-sans/700.css'
import '@fontsource/ibm-plex-sans-devanagari/400.css'
import '@fontsource/ibm-plex-sans-devanagari/600.css'
import './styles.css'
import Landing from './pages/Landing'
import DoctorApp from './apps/doctor/DoctorApp'
import StaffApp from './apps/staff/StaffApp'
import PatientApp from './apps/patient/PatientApp'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/doctor" element={<DoctorApp />} />
        <Route path="/staff" element={<StaffApp />} />
        <Route path="/patient" element={<PatientApp />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
)
