import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CalendarPlus, Check, FileText, Mic, Pause, Pill, RotateCcw, Send, Sparkles, Square, Stethoscope, User, Video } from "lucide-react";
import { request } from "./client";
import { GlassOrb, useTilt } from "./Glass3D";
import { toast } from "./toast";

const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
const LANG = { en: "en-IN", hi: "hi-IN", mr: "mr-IN" };
const SECTIONS = [["subjective", "Subjective", "What the patient reports"], ["objective", "Objective", "Findings, vitals, results"], ["assessment", "Assessment", "Clinical impression"], ["plan", "Plan", "Next steps and orders"]];

function nextClinicDay(days) {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  d.setDate(d.getDate() + Math.max(1, days || 7));
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T11:00`;
}

export default function ConsultStudio({ pid, patient }) {
  const [lines, setLines] = useState([]), [interim, setInterim] = useState(""), [speaker, setSpeaker] = useState("Doctor");
  const [recording, setRecording] = useState(false), [seconds, setSeconds] = useState(0), [consent, setConsent] = useState(false);
  const [language, setLanguage] = useState(patient?.preferred_language || "en"), [typed, setTyped] = useState("");
  const [note, setNote] = useState(null), [busy, setBusy] = useState(""), [error, setError] = useState(""), [signed, setSigned] = useState(null), [booked, setBooked] = useState(null);
  const recRef = useRef(null), streamRef = useRef(null), rafRef = useRef(0), orbRef = useRef(null), speakerRef = useRef(speaker), logRef = useRef(null);
  const tilt = useTilt(6);
  useEffect(() => { speakerRef.current = speaker; }, [speaker]);
  useEffect(() => { if (!recording) return; const t = setInterval(() => setSeconds((s) => s + 1), 1000); return () => clearInterval(t); }, [recording]);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" }); }, [lines, interim]);
  useEffect(() => () => stop(), []);
  const transcript = [...lines.map((l) => `${l.who}: ${l.text}`), typed.trim()].filter(Boolean).join("\n");

  const start = async () => {
    setError("");
    if (!consent) { setError("Confirm the patient agreed to transcription first."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = ctx.createAnalyser(); analyser.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const loop = () => {
        analyser.getByteFrequencyData(data);
        const level = data.reduce((a, b) => a + b, 0) / data.length / 255;
        orbRef.current?.style.setProperty("--lvl", (1 + level * 0.9).toFixed(3));
        rafRef.current = requestAnimationFrame(loop);
      };
      loop();
    } catch { setError("Microphone access was blocked. You can type the consult instead."); return; }
    if (!SR) { setError("Live transcription needs Chrome or Edge. You can type the consult below."); }
    else {
      const rec = new SR();
      rec.lang = LANG[language] || "en-IN"; rec.continuous = true; rec.interimResults = true;
      rec.onresult = (e) => {
        let live = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) { const text = r[0].transcript.trim(); if (text) setLines((l) => [...l, { who: speakerRef.current, text, at: Date.now() }]); }
          else live += r[0].transcript;
        }
        setInterim(live);
      };
      rec.onend = () => { if (recRef.current === rec) try { rec.start(); } catch { /* restarting */ } };
      recRef.current = rec;
      try { rec.start(); } catch { /* already started */ }
    }
    setRecording(true);
  };
  function stop() {
    const rec = recRef.current; recRef.current = null; try { rec?.stop(); } catch { /* stopped */ }
    streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null;
    cancelAnimationFrame(rafRef.current); orbRef.current?.style.setProperty("--lvl", 1);
    setRecording(false); setInterim("");
  }
  const generate = async () => {
    stop(); setError(""); setBusy("note");
    try { setNote(await request(`/v2/patients/${pid}/consult-note`, "POST", { transcript, language, consent: true })); }
    catch (e) { setError(e.message); } finally { setBusy(""); }
  };
  const sign = async () => {
    setBusy("sign"); setError("");
    try {
      const out = await request(`/v2/patients/${pid}/consult-note/sign`, "POST", { transcript, language, share_with_patient: true, ...Object.fromEntries(["subjective", "objective", "assessment", "plan", "patient_summary"].map((k) => [k, note[k] || ""])) });
      setSigned(out); toast(out.message);
    } catch (e) { setError(e.message); } finally { setBusy(""); }
  };
  const book = async () => {
    setBusy("book"); setError("");
    try {
      const meet = note.follow_up_mode === "google_meet";
      const out = await request("/v2/assistant/execute", "POST", { intent: "book_visit", patient_id: pid, params: { mode: meet ? "google_meet" : "in_person", department: "Medical Oncology OPD", start: nextClinicDay(note.follow_up_days), notes: "Follow-up booked from Consult Studio", invitation_consent: meet } });
      setBooked(out); toast(out.message);
    } catch (e) { setError(e.message); } finally { setBusy(""); }
  };
  const reset = () => { stop(); setLines([]); setTyped(""); setNote(null); setSigned(null); setBooked(null); setSeconds(0); setError(""); };
  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  return <div className="ob-studio">
    <section className="ob-hero ob-studio-hero" ref={tilt}>
      <div>
        <span className="ob-hero-eyebrow"><Stethoscope size={13} />{patient?.name || "Patient"} · {patient?.cancer_type || "Consult"}</span>
        <h2>{recording ? "Listening…" : note ? "Your note is ready" : "Talk. We'll write the note."}</h2>
        <p>{recording ? "Speak naturally. Tap who's talking so the note knows who said what." : note ? "Review, edit and sign. The patient gets a plain-language summary in their language." : "Record the consult and get a SOAP note, a patient summary and the follow-up, ready to sign in seconds."}</p>
        {!note && <div className="ob-studio-controls">
          <label className="ob-studio-consent"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={recording} /><span>Patient agreed to this consult being transcribed</span></label>
          <div className="ob-hero-actions">
            {!recording ? <button className="ob-pill" onClick={start} disabled={busy}><Mic size={17} />{lines.length ? "Resume" : "Start recording"}</button> : <button className="ob-pill" onClick={stop}><Pause size={17} />Pause</button>}
            <select className="ob-pill ghost ob-lang" value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Patient language" disabled={recording}><option value="en">English</option><option value="hi">हिंदी</option><option value="mr">मराठी</option></select>
          </div>
        </div>}
      </div>
      <div className="ob-hero-art ob-studio-orb" ref={orbRef}>
        <GlassOrb size={190} colors={recording ? ["#ffd6ec", "#b37bff", "#4b2fd1"] : ["#e7ddff", "#8f6bff", "#3b25a8"]} pulse={recording}>
          <div className="ob-score">{recording ? <><b className="ob-rec-dot" />{mmss}</> : note ? <Check size={44} /> : <Mic size={40} />}</div>
        </GlassOrb>
      </div>
    </section>

    {error && <p className="care-error" role="alert">{error}</p>}

    {!note && <section className="ob-card ob-transcript">
      <div className="ob-card-head">
        <span className="ob-chip"><FileText size={14} />Live transcript</span>
        <div className="ob-speaker" role="radiogroup" aria-label="Who is speaking">
          {[["Doctor", Stethoscope], ["Patient", User]].map(([who, Icon]) => <button key={who} role="radio" aria-checked={speaker === who} className={speaker === who ? "active" : ""} onClick={() => setSpeaker(who)}><Icon size={14} />{who}</button>)}
        </div>
      </div>
      <div className="ob-transcript-log" ref={logRef}>
        {lines.map((l, i) => <p key={i} className={`who-${l.who.toLowerCase()}`}><b>{l.who}</b>{l.text}</p>)}
        {interim && <p className={`who-${speaker.toLowerCase()} interim`}><b>{speaker}</b>{interim}</p>}
        {!lines.length && !interim && <div className="ob-transcript-empty"><Mic size={22} /><span>Start recording, or type the consult below.</span></div>}
      </div>
      <textarea className="input" rows={3} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type or paste notes here, e.g. “Patient reports nausea for 3 days after cycle 4… Plan: repeat CBC, review in 1 week by video.”" />
      <div className="ob-studio-foot">
        <button className="btn" onClick={reset} disabled={!transcript}><RotateCcw size={15} />Clear</button>
        <button className="btn primary" onClick={generate} disabled={transcript.length < 10 || busy === "note"}>{busy === "note" ? "Writing note…" : <><Sparkles size={16} />Create note</>}</button>
      </div>
    </section>}

    {note && <>
      <div className="ob-soap">
        {SECTIONS.map(([key, label, hint]) => <section key={key} className={`ob-card ob-soap-card soap-${key}`}>
          <div className="ob-card-head"><span className="ob-soap-letter">{label[0]}</span><div><b>{label}</b><small>{hint}</small></div></div>
          <textarea className="ob-soap-text" value={note[key] || ""} onChange={(e) => setNote({ ...note, [key]: e.target.value })} placeholder="Nothing recorded" rows={4} />
        </section>)}
      </div>

      {(note.red_flags?.length > 0 || note.medicines_to_review?.length > 0) && <div className="ob-flags">
        {note.red_flags?.map((f) => <span key={f} className="ob-flag danger"><AlertTriangle size={14} />{f}</span>)}
        {note.medicines_to_review?.map((m) => <span key={m} className="ob-flag"><Pill size={14} />Review: {m}</span>)}
      </div>}

      <section className="ob-summary-card">
        <div className="ob-card-head"><span className="ob-chip light"><Send size={14} />Summary for {patient?.name?.split(" ")[0] || "the patient"}</span><small>{({ en: "English", hi: "हिंदी", mr: "मराठी" })[language]}</small></div>
        <textarea value={note.patient_summary || ""} onChange={(e) => setNote({ ...note, patient_summary: e.target.value })} rows={4} />
      </section>

      <div className="ob-studio-actions">
        <section className="ob-card ob-followup">
          <span className="ob-action-icon">{note.follow_up_mode === "google_meet" ? <Video size={17} /> : <CalendarPlus size={17} />}</span>
          <div><b>{booked ? booked.message : `Follow-up in ${note.follow_up_days || 7} days`}</b><small>{booked ? "Added to the patient's appointments" : note.follow_up_mode === "google_meet" ? "Google Meet video consult" : "Medical Oncology OPD, 11:00 am"}</small></div>
          {!booked && <button className="btn" onClick={book} disabled={busy === "book"}>{busy === "book" ? "Booking…" : "Book"}</button>}
        </section>
        <div className="ob-sign-row">
          <button className="btn" onClick={reset}><RotateCcw size={15} />New consult</button>
          {signed ? <span className="ob-signed"><Check size={16} />{signed.message}</span> : <button className="ob-cta ob-sign" onClick={sign} disabled={busy === "sign"}>{busy === "sign" ? "Signing…" : "Sign & send to patient"}<span><Square size={0} /><Check size={18} /></span></button>}
        </div>
      </div>
      <p className="ob-studio-note">Drafted by {note.model}. Nothing is saved or sent until you sign. Medicines are never prescribed from a transcript.</p>
    </>}
  </div>;
}
