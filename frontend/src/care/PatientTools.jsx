import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Flower2, Heart, Send } from "lucide-react";
import { request, useResource, dateTime, nice } from "./client";
import {
  Action,
  Empty,
  Error,
  Load,
  Panel,
  SourceLinks,
  Status,
  Voice,
} from "./UI";

const labels = {
  en: {
    title: "Your one-minute check-in",
    hint: "How have you felt since your last check-in?",
    nausea: "Nausea / vomiting",
    pain: "Pain",
    fatigue: "Tiredness",
    appetite: "Trouble eating",
    breathing: "Breathing difficulty",
    temp: "Temperature (°C)",
    distress: "Distress (0–10)",
    notes: "Anything unusual, even if it feels small?",
    send: "Send to my care team",
    grades: ["None", "Mild", "Moderate", "Severe", "Very severe"],
  },
  hi: {
    title: "आपका एक मिनट का चेक-इन",
    hint: "पिछले चेक-इन के बाद से आप कैसा महसूस कर रहे हैं?",
    nausea: "मतली / उल्टी",
    pain: "दर्द",
    fatigue: "थकान",
    appetite: "खाने में परेशानी",
    breathing: "साँस लेने में परेशानी",
    temp: "तापमान (°C)",
    distress: "मानसिक परेशानी (0–10)",
    notes: "कुछ असामान्य, भले ही छोटा लगे?",
    send: "अपनी देखभाल टीम को भेजें",
    grades: ["नहीं", "हल्का", "मध्यम", "गंभीर", "बहुत गंभीर"],
  },
  mr: {
    title: "तुमचा एक मिनिटाचा चेक-इन",
    hint: "मागील चेक-इनपासून तुम्हाला कसे वाटले?",
    nausea: "मळमळ / उलटी",
    pain: "वेदना",
    fatigue: "थकवा",
    appetite: "खाण्यात अडचण",
    breathing: "श्वास घेण्यास त्रास",
    temp: "तापमान (°C)",
    distress: "मानसिक त्रास (0–10)",
    notes: "काही वेगळे वाटले, अगदी लहान असले तरी?",
    send: "उपचार पथकाला पाठवा",
    grades: ["नाही", "सौम्य", "मध्यम", "तीव्र", "अतितीव्र"],
  },
};

export function CheckIn({ pid, language, onUpdate, phoneDemo = false }) {
  const [values, setValues] = useState({
    nausea: 0,
    pain: 0,
    fatigue: 0,
    appetite: 0,
    breathing: 0,
    distress: 0,
    text: "",
    temperature: "",
  });
  const [result, setResult] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const l = labels[language];
  useEffect(() => {
    setResult(null);
  }, [pid]);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await request(`/v2/patients/${pid}/checkin`, "POST", {
        ...values,
        language,
        temperature:
          values.temperature === "" ? null : Number(values.temperature),
        source: phoneDemo ? "phone_demo" : "tap",
      });
      setResult(r);
      onUpdate?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel
      title={phoneDemo ? "Browser call check-in" : l.title}
      hint={
        phoneDemo
          ? "A browser demonstration. No ordinary phone call is placed; configure telephony for real calls."
          : l.hint
      }
    >
      {result?.level === 3 && <Emergency result={result} />}
      <form className="stack" onSubmit={submit}>
        {["nausea", "pain", "fatigue", "appetite", "breathing"].map((key) => (
          <div className="care-symptom" key={key}>
            <label id={`label-${key}`}>{l[key]}</label>
            <div
              className="care-grades"
              role="group"
              aria-labelledby={`label-${key}`}
            >
              {l.grades.map((label, value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={values[key] === value}
                  className={values[key] === value ? "selected" : ""}
                  onClick={() => setValues((v) => ({ ...v, [key]: value }))}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className="grid2">
          <label className="field">
            {l.temp}
            <input
              className="input"
              type="number"
              step="0.1"
              min="30"
              max="45"
              value={values.temperature}
              onChange={(e) =>
                setValues((v) => ({ ...v, temperature: e.target.value }))
              }
            />
          </label>
          <label className="field">
            {l.distress}
            <input
              className="input"
              type="number"
              min="0"
              max="10"
              value={values.distress}
              onChange={(e) =>
                setValues((v) => ({ ...v, distress: Number(e.target.value) }))
              }
            />
          </label>
        </div>
        <label className="field">
          {l.notes}
          <textarea
            className="input"
            rows={3}
            value={values.text}
            onChange={(e) => setValues((v) => ({ ...v, text: e.target.value }))}
          />
        </label>
        <Voice
          language={language}
          onText={(text) =>
            setValues((v) => ({ ...v, text: `${v.text} ${text}`.trim() }))
          }
          text={phoneDemo ? l.hint : undefined}
        />
        <Error message={error} />
        {result && result.level !== 3 && (
          <p className="care-success">{result.instruction}</p>
        )}
        <button className="btn primary lg" disabled={busy}>
          {busy ? "Sending…" : l.send}
          <Send size={16} />
        </button>
      </form>
      {result && (
        <p className="small muted">
          Saved as R{result.id}.{" "}
          {result.nurse_notification &&
            "An in-app alert is visible to your care team. External messaging is separate."}
        </p>
      )}
    </Panel>
  );
}

export function Emergency({ result }) {
  return (
    <section className="care-emergency" role="alert">
      <h2>Get urgent help now</h2>
      <p>{result.instruction || result.answer}</p>
      <a
        className="btn"
        target="_blank"
        rel="noreferrer"
        href="https://www.google.com/maps/search/emergency+department+near+me/"
      >
        Find an emergency department
      </a>
      <p className="small">
        Care-team alert #{result.alert_id}. The app cannot confirm that a nurse
        has seen it or that an ER was contacted. Do not wait for a reply here.
      </p>
      <p className="small">
        The hospital's 60-minute treatment target starts at arrival. A nurse
        records arrival in the triage console.
      </p>
    </section>
  );
}

export function Companion({ pid, language, onOpen, clinician = false }) {
  const [text, setText] = useState(""),
    [messages, setMessages] = useState([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const activeRequest = useRef(0);
  useEffect(() => {
    activeRequest.current += 1;
    setMessages([]);
    setText("");
    setBusy(false);
    setError("");
    return () => { activeRequest.current += 1; };
  }, [pid]);
  const send = async (e) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    const question = text.trim();
    const current = ++activeRequest.current;
    setBusy(true);
    setError("");
    try {
      const r = await request(`/v2/patients/${pid}/companion`, "POST", {
        text: question,
        language,
      });
      if (current === activeRequest.current) {
        setMessages((m) => [...m, { question, ...r }]);
        setText("");
      }
    } catch (e) {
      if (current === activeRequest.current) setError(e.message);
    } finally {
      if (current === activeRequest.current) setBusy(false);
    }
  };
  return (
    <Panel
      title={clinician ? "AI Chat · patient records" : "AI Chat"}
      hint="Answers cite this patient's folder. Clinical questions go to the treating doctor."
    >
      <div className="care-chat-log">
        {!messages.length && (
          <Empty>
            Try “last CBC”, “heart scan” or a question about a report. You can
            also tell me how you are feeling.
          </Empty>
        )}
        {messages.map((m, i) => (
          <article key={i} className="care-answer">
            <div className="care-question">{m.question}</div>
            {m.level === 3 ? (
              <Emergency result={m} />
            ) : (
              <>
                {m.citations?.length ? m.citations.map((item, index) => (
                  <div key={index}>
                    <p className="care-pre">{item.text}</p>
                    <SourceLinks sources={m.sources.filter((s) => item.sources.includes(s.tag))} onOpen={onOpen} />
                  </div>
                )) : <><p className="care-pre">{m.answer}</p><SourceLinks sources={m.sources} onOpen={onOpen} /></>}
                {m.generation && <span className="small muted">{m.generation === "ai" ? "AI-assisted" : "From your records"}</span>}
                <Voice text={m.answer} language={language} />
                {m.translation && (
                  <p className="small muted">{m.translation}</p>
                )}
                <Status
                  value={
                    [
                      "inform",
                      "everyday_guidance",
                      "doctor_review",
                      "emergency",
                    ][m.level]
                  }
                />
              </>
            )}
          </article>
        ))}
      </div>
      <form className="stack" onSubmit={send}>
        <label className="field">
          Your question
          <textarea
            className="input"
            required
            disabled={busy}
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <Voice
          language={language}
          onText={(v) => setText((t) => `${t} ${v}`.trim())}
        />
        <Error message={error} />
        <button className="btn primary" disabled={busy}>
          {busy ? "Reading your folder…" : "Send to AI Chat"}
        </button>
      </form>
    </Panel>
  );
}

export function Medicines({ pid, user, onUpdate }) {
  const meds = useResource(`/patients/${pid}/medications`);
  const approvals = useResource(`/v2/patients/${pid}/approvals`, 15000);
  const [requestText, setRequestText] = useState(""),
    [error, setError] = useState(""),
    [result, setResult] = useState(null),
    [busy, setBusy] = useState(false),
    [scan, setScan] = useState(null);
  const [scanFile, setScanFile] = useState(null),
    [selectedMed, setSelectedMed] = useState("");
  const ask = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await request(`/v2/patients/${pid}/approvals`, "POST", {
        kind: "medicine",
        request: requestText,
      });
      setResult(r);
      setRequestText("");
      approvals.refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="care-columns">
      <div className="stack">
        <Panel
          title="Today's medicines"
          hint="Only active, signed prescriptions appear here."
        >
          <Load resource={meds}>
            {(items) =>
              items.length ? (
                items.map((m) => (
                  <article className="care-med" key={m.id}>
                    <div className="row">
                      <b>{m.name}</b>
                      <span className="care-pill">{m.dose}</span>
                    </div>
                    <p className="small muted">
                      {m.frequency} · {m.instructions}
                    </p>
                    {m.today.map((d) => (
                      <div className="care-dose row wrap" key={d.time}>
                        <b>{d.time}</b>
                        <Status value={d.status} />
                        <span className="spacer" />
                        {["taken", "missed"].map((status) => (
                          <Action
                            key={status}
                            run={() =>
                              request("/med-logs", "POST", {
                                medication_id: m.id,
                                time: d.time,
                                status,
                              })
                            }
                            onDone={() => {
                              meds.refresh();
                              onUpdate?.();
                            }}
                          >
                            {status === "taken" ? "Taken" : "Missed"}
                          </Action>
                        ))}
                      </div>
                    ))}
                  </article>
                ))
              ) : (
                <Empty>No active prescription recorded.</Empty>
              )
            }
          </Load>
        </Panel>
        <Panel
          title="Scan before you swallow"
          hint="OCR compares generic name, strength and expiry with the active prescription. A pharmacist must confirm uncertain or brand-name matches."
        >
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setError("");
              setBusy(true);
              try {
                const form = new FormData();
                form.append("file", scanFile);
                if (selectedMed) form.append("medication_id", selectedMed);
                setScan(
                  await request(
                    `/v2/patients/${pid}/medicine-scan`,
                    "POST",
                    form,
                  ),
                );
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="field">
              Prescription to compare
              <select
                className="select"
                value={selectedMed}
                onChange={(e) => setSelectedMed(e.target.value)}
              >
                <option value="">All active medicines</option>
                {meds.data?.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} {m.dose}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Strip / bottle photo
              <input
                type="file"
                accept="image/*"
                capture="environment"
                required
                onChange={(e) => setScanFile(e.target.files[0])}
              />
            </label>
            <button className="btn" disabled={busy}>
              <Camera size={16} />
              Check strip
            </button>
          </form>
          {scan && (
            <div className="care-notice">
              <Status value={scan.status} />
              <p>{scan.message}</p>
              {scan.data.warnings.map((w) => (
                <p key={w}>{w}</p>
              ))}
              <details>
                <summary>OCR text and confidence</summary>
                <p className="care-pre">
                  {scan.data.ocr_text || "OCR unavailable"} ·{" "}
                  {scan.data.confidence ?? "unknown"}%
                </p>
              </details>
            </div>
          )}
        </Panel>
      </div>
      <div className="stack">
        <Panel title="Ask the doctor about a medicine">
          <form className="stack" onSubmit={ask}>
            <label className="field">
              What help do you need?
              <textarea
                className="input"
                required
                minLength={3}
                rows={4}
                value={requestText}
                onChange={(e) => setRequestText(e.target.value)}
              />
            </label>
            <button className="btn primary" disabled={busy}>
              Send request to doctor
            </button>
          </form>
          {result?.emergency && <Emergency result={result} />}
          <Error message={error} />
        </Panel>
        <Panel title="Medicine request tracker">
          <Load resource={approvals}>
            {(items) =>
              items.length ? (
                items.map((a) => (
                  <article className="care-record" key={a.id}>
                    <div className="row wrap">
                      <b>
                        #{a.id} · {a.request}
                      </b>
                      <Status value={a.status} />
                    </div>
                    <div className="care-tracker">
                      {["sent", "reviewing", "approved"].map((stage, i) => (
                        <span
                          key={stage}
                          className={
                            ["sent", "reviewing", "approved"].indexOf(
                              a.status,
                            ) >= i
                              ? "done"
                              : ""
                          }
                        >
                          {stage === "reviewing" ? "Doctor reviewing" : stage}
                        </span>
                      ))}
                      <span className={a.medication_id ? "done" : ""}>
                        Reminders set
                      </span>
                    </div>
                    {a.status === "approved" && (
                      <p className="care-signed">
                        {a.draft.medicine} {a.draft.dose} ·{" "}
                        {a.draft.instructions}
                        <br />
                        Signed by {a.reviewed_by}
                      </p>
                    )}
                    {a.reason && <p className="small">{a.reason}</p>}
                  </article>
                ))
              ) : (
                <Empty>No requests yet.</Empty>
              )
            }
          </Load>
        </Panel>
      </div>
    </div>
  );
}

export function Wellness({ pid, language, canTeachBack = true, viewerRole = "patient" }) {
  const patientView = viewerRole === "patient";
  const resource = useResource(`/v2/patients/${pid}/wellness`),
    week = useResource(`/v2/patients/${pid}/week`);
  const [played, setPlayed] = useState(false),
    [answer, setAnswer] = useState(""),
    [feedback, setFeedback] = useState("");
  return (
    <div className="care-columns">
      <div className="stack">
        <Panel title="Food, energy & everyday life">
          <Load resource={resource}>
            {(d) => (
              <>
                {d.low_counts && (
                  <p className="care-notice">
                    Recorded neutrophils are low. {d.activity_gate}
                  </p>
                )}
                <p>{d.activity}</p>
                {d.guidance.map((g) => (
                  <article className="care-library" key={g.id}>
                    <h3>{g.title}</h3>
                    <p>{g.content[language] || g.content.en}</p>
                    <a href={g.source_url} target="_blank" rel="noreferrer">
                      Source
                    </a>
                    <small className="muted">
                      {" "}
                      · Library review: {g.approved_by}
                    </small>
                  </article>
                ))}
                {!d.library_ready && (
                  <Empty>
                    The doctor and dietitian need to approve the guidance
                    library.
                  </Empty>
                )}
                {d.meal_plan.length > 0 && (
                  <details>
                    <summary>Seven-day meal ideas · {d.diet}</summary>
                    {d.meal_plan.map((m) => (
                      <p key={m.day}>
                        <b>Day {m.day}:</b> {m.suggestion}
                      </p>
                    ))}
                  </details>
                )}
              </>
            )}
          </Load>
        </Panel>
        {canTeachBack && <TeachBack pid={pid} />}
        <EducationLibrary language={language} />
      </div>
      <div className="stack">
        <Panel title="Your week, wrapped" className="care-garden">
          <Load resource={week}>
            {(w) => (
              <>
                <Flower2 size={48 + w.garden_stage * 6} />
                <h3>{w.checkin_days} days of showing up for yourself</h3>
                <div className="care-metrics">
                  <div>
                    <b>{w.doses_taken}</b>
                    <span>doses taken</span>
                  </div>
                  {!patientView && <div>
                    <b>{w.steps.toLocaleString()}</b>
                    <span>steps recorded</span>
                  </div>}
                  <div>
                    <b>{w.garden_stage}/5</b>
                    <span>garden stage</span>
                  </div>
                </div>
                <p className="small">
                  Missed a day? You can begin again today.
                  {!patientView && <> Best step day: {w.best_day || "not recorded yet"}.</>}
                </p>
                <button className="btn" onClick={() => window.print()}>
                  Print my Week Wrapped
                </button>
              </>
            )}
          </Load>
        </Panel>
        <Panel
          title="A gentle memory game"
          hint="A small break for a low-energy day."
        >
          <MemoryGame key={pid} />
        </Panel>
        {!patientView && <Panel title="Activity & wearable log">
          <SimpleActivity pid={pid} onDone={() => week.refresh()} />
        </Panel>}
      </div>
    </div>
  );
}

function MemoryGame() {
  const [cards, setCards] = useState(() =>
      ["🌻", "🌷", "🍀", "🌻", "🌷", "🍀"].sort(() => Math.random() - 0.5),
    ),
    [open, setOpen] = useState([]),
    [matched, setMatched] = useState([]);
  useEffect(() => {
    if (open.length !== 2) return;
    const timer = setTimeout(() => {
      if (cards[open[0]] === cards[open[1]]) setMatched((m) => [...m, ...open]);
      setOpen([]);
    }, 700);
    return () => clearTimeout(timer);
  }, [open, cards]);
  return (
    <>
      <div className="care-memory">
        {cards.map((c, i) => (
          <button
            key={i}
            disabled={
              matched.includes(i) || open.includes(i) || open.length === 2
            }
            aria-label={`Memory card ${i + 1}`}
            onClick={() => setOpen((v) => [...v, i])}
          >
            {matched.includes(i) || open.includes(i) ? c : "✿"}
          </button>
        ))}
      </div>
      {matched.length === 6 && (
        <p className="care-success">
          A garden of matches. Take a breath and enjoy the pause.
        </p>
      )}
    </>
  );
}

function SimpleActivity({ pid, onDone }) {
  const [v, setV] = useState({ steps: "", sleep_hours: "", resting_hr: "" }),
    [message, setMessage] = useState("");
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await request(
            `/v2/patients/${pid}/activity`,
            "POST",
            Object.fromEntries(
              Object.entries(v).map(([k, x]) => [k, Number(x)]),
            ),
          );
          setMessage("Saved as a manual entry.");
          onDone();
        } catch (e) {
          setMessage(e.message);
        }
      }}
    >
      {Object.entries(v).map(([key, value]) => (
        <label className="field" key={key}>
          {nice(key)}
          <input
            className="input"
            type="number"
            required
            min="0"
            max={key === "steps" ? 200000 : key === "sleep_hours" ? 24 : 250}
            step="any"
            value={value}
            onChange={(e) => setV({ ...v, [key]: e.target.value })}
          />
        </label>
      ))}
      <button className="btn">Save today's activity</button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}

function TeachBack({ pid }) {
  const [answers, setAnswers] = useState(["", "", ""]),
    [result, setResult] = useState(null);
  const qs = [
    [
      "If you develop a fever during treatment, what should you do?",
      [
        ["wait", "Wait for the next routine visit"],
        [
          "contact",
          "Contact the team promptly and follow emergency instructions",
        ],
      ],
    ],
    [
      "Who approves a new medicine or dose change?",
      [
        ["ai", "The AI alone"],
        ["doctor", "My treating doctor"],
      ],
    ],
    [
      "Where can you check a quoted result?",
      [
        ["memory", "Only the chat reply"],
        ["original", "The cited original report"],
      ],
    ],
  ];
  return (
    <Panel
      title="Teach-back: three quick questions"
      hint="If an answer is unclear, your nurse can help explain it again."
    >
      {qs.map(([q, options], i) => (
        <label className="field" style={{ marginBottom: 16 }} key={q}>
          {q}
          <select
            className="select"
            value={answers[i]}
            onChange={(e) =>
              setAnswers((v) => v.map((x, j) => (i === j ? e.target.value : x)))
            }
          >
            <option value="">Choose…</option>
            {options.map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </label>
      ))}
      <Action
        run={() => {
          if (answers.some((a) => !a))
            throw new Error("Please answer all three questions.");
          return request(`/v2/patients/${pid}/teach-back`, "POST", { answers });
        }}
        onDone={setResult}
      >
        Check understanding
      </Action>
      {result && (
        <p className="care-notice">
          {result.score}/3 · {result.message}
        </p>
      )}
    </Panel>
  );
}

function EducationLibrary({ language }) {
  const resource = useResource("/v2/library"),
    [selected, setSelected] = useState("family");
  const items = (resource.data || []).filter((x) => x.approved_by);
  const item = items.find((x) => x.key === selected) || items[0];
  return (
    <Panel
      title="Patient leaflets & explain to my family"
      hint="Print approved education in the available language, and discuss it with your nurse."
    >
      <select
        className="select"
        aria-label="Leaflet topic"
        value={item?.key || ""}
        onChange={(e) => setSelected(e.target.value)}
      >
        {items.map((x) => (
          <option key={x.key} value={x.key}>
            {x.title}
          </option>
        ))}
      </select>
      {item && (
        <article className="care-library">
          <h3>{item.title}</h3>
          <p>{item.content[language] || item.content.en}</p>
          {language !== "en" && !item.content[language] && (
            <p className="small muted">
              No approved translation for this item yet; showing the original
              English.
            </p>
          )}
          <a href={item.source_url} target="_blank" rel="noreferrer">
            Source
          </a>
          <Voice
            text={item.content[language] || item.content.en}
            language={item.content[language] ? language : "en"}
          />
          <button className="btn" onClick={() => window.print()}>
            Print approved leaflet
          </button>
        </article>
      )}
      <Error message={resource.error} />
    </Panel>
  );
}
