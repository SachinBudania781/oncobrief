import { Link } from "react-router-dom";
import { Stethoscope, ScanLine, Smartphone, ArrowRight } from "lucide-react";
import { Logo } from "../components/TopBar";
import { REPO_URL, VIDEO_URL } from "../config";

export default function Landing() {
  return (
    <div className="landing">
      <section className="landing-hero">
        <div className="landing-inner">
          <div className="brandline">
            <Logo size={30} />
            <b style={{ color: "#fff", fontSize: 18 }}>OncoBrief</b>
            <span>
              Team TripleT · Health-a-thon 2026 · Cancer Care (NCG) track
            </span>
          </div>
          <h1>Cancer care that stays with you, between visits.</h1>
          <p className="lede">
            A daily companion for patients, a care circle for families, and a
            connected workspace for doctors and nurses. Every clinical change
            waits for the treating doctor’s signature.
          </p>
          <div className="doors">
            <Link to="/doctor" className="door doctor">
              <Stethoscope size={26} color="#f3b44a" />
              <h3>Doctor app</h3>
              <p>
                Review who needs a call, approve prescriptions, ask the chart
                and follow the patient’s response over time. Every source stays
                one click away.
              </p>
              <span className="go">
                Open doctor app <ArrowRight size={16} />
              </span>
            </Link>
            <Link to="/staff" className="door">
              <ScanLine size={26} color="#f3b44a" />
              <h3>Staff app</h3>
              <p>
                Triage home alerts, verify patient identity before filing
                reports, organise entire bundles and keep the hospital day
                moving.
              </p>
              <span className="go">
                Open staff app <ArrowRight size={16} />
              </span>
            </Link>
            <Link to="/patient" className="door">
              <Smartphone size={26} color="#f3b44a" />
              <h3>Patient app</h3>
              <p>
                Check in by voice or taps, understand your records, track
                medicine requests, invite a caregiver and plan your next
                hospital day.
              </p>
              <span className="go">
                Open patient app <ArrowRight size={16} />
              </span>
            </Link>
          </div>
        </div>
      </section>
      <section className="flow">
        <h2 style={{ color: "#fff" }}>Try it in one minute</h2>
        <ol>
          <li>
            <h3>Staff scans today's blood report</h3>
            <p>
              In the staff app, enter patient <b>OB-2026-0001</b> (Meera
              Kulkarni) and press <i>Scan page</i>. The page is read and filed
              in her folder.
            </p>
          </li>
          <li>
            <h3>Doctor opens the brief</h3>
            <p>
              In the doctor app, pick Meera from today's clinic and choose{" "}
              <i>Follow-up</i>. The new blood count is already in the brief,
              with a link to the scan.
            </p>
          </li>
          <li>
            <h3>Patient reports from home</h3>
            <p>
              In the patient app, log a symptom or a missed dose. Regenerate the
              brief and it appears under “Reported by the patient”.
            </p>
          </li>
        </ol>
      </section>
      <footer className="landing-foot">
        <div className="landing-inner row wrap" style={{ gap: 18 }}>
          <span>
            All patients, hospitals and reports here are fabricated. AI
            suggests. The treating doctor signs every clinical change.
          </span>
          <span className="spacer" />
          <a href="/docs">API docs</a>
          {REPO_URL && <a href={REPO_URL}>Source code</a>}
          {VIDEO_URL && <a href={VIDEO_URL}>Demo video</a>}
          <Link to="/app">Sign in to Round 2</Link>
        </div>
      </footer>
    </div>
  );
}
