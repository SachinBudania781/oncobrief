// Thin API client. The acting role is sent with every request so the backend can keep an audit log.
let actor = { role: 'anonymous', name: 'Demo user' }
export const setActor = (role, name) => { actor = { role, name } }

async function req(path, opts = {}) {
  const headers = { 'X-Actor-Role': actor.role, 'X-Actor-Name': actor.name, ...(opts.headers || {}) }
  const res = await fetch(path, { ...opts, headers })
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try { const j = await res.json(); msg = j.detail || msg } catch { /* not json */ }
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  return res.json()
}
const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export const api = {
  taxonomy: () => req('/api/taxonomy'),
  aiStatus: () => req('/api/ai-status'),
  stats: () => req('/api/stats'),
  patients: (q = '') => req(`/api/patients?q=${encodeURIComponent(q)}`),
  patient: (id) => req(`/api/patients/${encodeURIComponent(id)}`),
  createPatient: (body) => req('/api/patients', json('POST', body)),
  documents: (id, params = {}) => req(`/api/patients/${encodeURIComponent(id)}/documents?${new URLSearchParams(params)}`),
  document: (docId) => req(`/api/documents/${docId}`),
  recentDocuments: (department = '') => req(`/api/documents/recent?department=${encodeURIComponent(department)}`),
  upload: (form) => req('/api/documents', { method: 'POST', body: form }),
  labs: (id) => req(`/api/patients/${encodeURIComponent(id)}/labs`),
  medications: (id) => req(`/api/patients/${encodeURIComponent(id)}/medications`),
  logMed: (body) => req('/api/med-logs', json('POST', body)),
  symptoms: (id) => req(`/api/patients/${encodeURIComponent(id)}/symptoms`),
  reportSymptoms: (body) => req('/api/symptom-reports', json('POST', body)),
  activity: (id) => req(`/api/patients/${encodeURIComponent(id)}/activity`),
  appointments: (params = {}) => req(`/api/appointments?${new URLSearchParams(params)}`),
  book: (body) => req('/api/appointments', json('POST', body)),
  slots: (department, day) => req(`/api/slots?department=${encodeURIComponent(department)}&day=${day}`),
  schedule: (day) => req(`/api/schedule${day ? `?day=${day}` : ''}`),
  brief: (patient_id, visit_type) => req('/api/brief', json('POST', { patient_id, visit_type })),
  audit: (patient_id) => req(`/api/audit${patient_id ? `?patient_id=${patient_id}` : ''}`),
  scan: async (n = 0) => {
    const res = await fetch(`/api/scanner/scan?n=${n}`)
    if (!res.ok) throw new Error('Scanner not available')
    const blob = await res.blob()
    return new File([blob], res.headers.get('X-Scan-Name') || 'scan.jpg', { type: 'image/jpeg' })
  },
  resetDemo: () => req('/api/admin/reset-demo', { method: 'POST' }),
}

// ---- formatting helpers ----
export const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
export const fmtShort = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
export const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
export const todayISO = () => {
  const d = new Date(); const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
export const nowLocalInput = () => {
  const d = new Date(); const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
export const CATEGORY_COLORS = {
  'Lab report': 'var(--c-lab)', Pathology: 'var(--c-path)', Imaging: 'var(--c-img)', Treatment: 'var(--c-treat)',
  'Clinical note': 'var(--c-note)', Prescription: 'var(--c-rx)', 'Patient-reported': 'var(--c-pt)',
}
export const VISIT_LABEL = { follow_up: 'Follow-up', new: 'New patient', transfer: 'Hospital transfer', procedure: 'Procedure' }
export const LANG_LABEL = { en: 'English', hi: 'हिंदी', mr: 'मराठी' }
