import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Stethoscope, ScanLine, Smartphone, ArrowRight, RotateCcw } from 'lucide-react'
import { Logo } from '../components/TopBar'
import { api } from '../api'
import { REPO_URL, VIDEO_URL } from '../config'

export default function Landing() {
  const [resetting, setResetting] = useState(false)
  const reset = async () => { setResetting(true); try { await api.resetDemo() } finally { setResetting(false) } }
  return (
    <div className="landing">
      <section className="landing-hero">
        <div className="landing-inner">
          <div className="brandline"><Logo size={30} /><b style={{ color: '#fff', fontSize: 18 }}>OncoBrief</b><span>Team TripleT · Health-a-thon 2026 · Cancer Care (NCG) track</span></div>
          <h1>Every oncology consult starts with the whole story.</h1>
          <p className="lede">
            One central folder per patient, filled by three connected apps. Before the visit, the oncologist gets a one-page brief
            of the patient's journey, and every line links to the original report.
          </p>
          <div className="doors">
            <Link to="/doctor" className="door doctor">
              <Stethoscope size={26} color="#f3b44a" />
              <h3>Doctor app</h3>
              <p>Scan the patient's QR, choose New, Follow-up or Hospital transfer, and read the brief. Search any report by type, date or the words inside it.</p>
              <span className="go">Open doctor app <ArrowRight size={16} /></span>
            </Link>
            <Link to="/staff" className="door">
              <ScanLine size={26} color="#f3b44a" />
              <h3>Staff app</h3>
              <p>Labs, radiology and every other department file reports straight into the right patient folder by type. Scan pages, register patients, and see every department's schedule with clashes marked.</p>
              <span className="go">Open staff app <ArrowRight size={16} /></span>
            </Link>
            <Link to="/patient" className="door">
              <Smartphone size={26} color="#f3b44a" />
              <h3>Patient app</h3>
              <p>Medicine reminders, a symptom form in English, Hindi or Marathi, outside reports uploaded by photo, and appointment booking.</p>
              <span className="go">Open patient app <ArrowRight size={16} /></span>
            </Link>
          </div>
        </div>
      </section>
      <section className="flow">
        <h2 style={{ color: '#fff' }}>Try it in one minute</h2>
        <ol>
          <li>
            <h3>Staff scans today's blood report</h3>
            <p>In the staff app, enter patient <b>OB-2026-0001</b> (Meera Kulkarni) and press <i>Scan page</i>. The page is read and filed in her folder.</p>
          </li>
          <li>
            <h3>Doctor opens the brief</h3>
            <p>In the doctor app, pick Meera from today's clinic and choose <i>Follow-up</i>. The new blood count is already in the brief, with a link to the scan.</p>
          </li>
          <li>
            <h3>Patient reports from home</h3>
            <p>In the patient app, log a symptom or a missed dose. Regenerate the brief and it appears under “Reported by the patient”.</p>
          </li>
        </ol>
      </section>
      <footer className="landing-foot">
        <div className="landing-inner row wrap" style={{ gap: 18 }}>
          <span>All patients, hospitals and reports here are fabricated. OncoBrief summarises records; it does not diagnose or recommend treatment.</span>
          <span className="spacer" />
          <a href="/docs">API docs</a>
          {REPO_URL && <a href={REPO_URL}>Source code</a>}
          {VIDEO_URL && <a href={VIDEO_URL}>Demo video</a>}
          <button className="btn ghost" style={{ color: '#cfc7e8', height: 30 }} onClick={reset} disabled={resetting}><RotateCcw size={14} /> {resetting ? 'Resetting…' : 'Reset demo data'}</button>
        </div>
      </footer>
    </div>
  )
}
