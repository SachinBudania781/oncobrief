import { useEffect, useRef, useState } from "react";
import { Info, Mic, Volume2 } from "lucide-react";
import Modal from "./Modal";
import { dateTime, nice, request, speak } from "./client";
import AudioRecorder from "./AudioRecorder";

export function InfoButton({ title = "About this feature", children }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className="care-info-button" aria-label={`About ${title}`} onClick={() => setOpen(true)}><Info size={17} /></button>{open && <Modal title={title} onClose={() => setOpen(false)}><div className="care-information">{children}</div></Modal>}</>;
}

export const Panel = ({ title, hint, children, className = "", action }) => (
  <section className={`care-panel ${className}`}>
    <div className="care-panel-head">
      <div>
        {title && <h2>{title}</h2>}
      </div>
      <div className="row">{hint && <InfoButton title={title}>{hint}</InfoButton>}{action}</div>
    </div>
    {children}
  </section>
);
export const Error = ({ message }) =>
  message ? (
    <p className="care-error" role="alert">
      {message}
    </p>
  ) : null;
export const Empty = ({ children = "Nothing here yet." }) => (
  <div className="care-empty">{children}</div>
);
export const Status = ({ value }) => (
  <span className={`care-status status-${value}`}>{nice(value)}</span>
);
export const Load = ({ resource, children }) =>
  resource.enabled === false ? (
    <Empty>This information is not shared with your account.</Empty>
  ) : resource.error ? (
    <Error message={resource.error} />
  ) : !resource.data ? (
    <p className="care-loading">Loading…</p>
  ) : (
    children(resource.data)
  );

export function Action({ children, run, onDone, className = "btn" }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <span className="care-action">
      <button
        className={className}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const result = await run();
            onDone?.(result);
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Saving…" : children}
      </button>
      <Error message={error} />
    </span>
  );
}

export function Voice({ language = "en", onText, text }) {
  const [listening, setListening] = useState(false),
    [error, setError] = useState("");
  const recognition = useRef(null);
  useEffect(
    () => () => {
      recognition.current?.abort();
      window.speechSynthesis?.cancel();
    },
    [],
  );
  const start = () => {
    setError("");
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError(
        "Voice input is unavailable in this browser. You can type, or use a configured speech service.",
      );
      return;
    }
    const r = new SpeechRecognition();
    r.lang = { en: "en-IN", hi: "hi-IN", mr: "mr-IN" }[language] || "en-IN";
    r.interimResults = false;
    r.onresult = (e) => onText?.(e.results[0][0].transcript);
    r.onerror = (e) => {
      setError("Voice input: " + e.error);
      setListening(false);
    };
    r.onend = () => setListening(false);
    recognition.current = r;
    try {
      r.start();
      setListening(true);
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <div className="care-voice">
      <div className="row wrap">
        {onText && (
          <button
            type="button"
            className={`btn ${listening ? "danger" : ""}`}
            onClick={start}
          >
            <Mic size={16} />
            {listening ? "Stop listening" : "Speak"}
          </button>
        )}
        {text && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              try {
                speak(text, language);
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            <Volume2 size={16} />
            Listen
          </button>
        )}
      </div>
      {onText && (
        <InfoButton title="Voice input">
          Your browser asks for microphone permission. Browser speech may use
          its speech provider.
        </InfoButton>
      )}
      <Error message={error} />
    </div>
  );
}

export function SourceLinks({ sources = [], onOpen }) {
  return (
    <div className="row wrap">
      {sources.map((s, i) =>
        s.id ? (
          <button
            className="src"
            key={s.tag || i}
            onClick={() => onOpen?.(s.id)}
          >
            {s.tag} · {s.title}
          </button>
        ) : s.record_id ? (
          <button
            className="src"
            key={s.tag || i}
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("ob-open-record", { detail: s.record_id }),
              )
            }
          >
            {s.tag} · {s.title}
          </button>
        ) : s.url ? (
          <a key={i} target="_blank" rel="noreferrer" href={s.url}>
            {s.title}
          </a>
        ) : s.tag ? (
          <span className="src" key={s.tag || i}>{s.tag} · {s.title}</span>
        ) : null,
      )}
    </div>
  );
}

export function RecordForm({ kind, spec, pid, onSaved }) {
  const [values, setValues] = useState({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    setValues({});
    setSaved(false);
    setError("");
  }, [pid, kind]);
  useEffect(() => {
    const select = (e) => {
      if (kind === "pain") setValues((v) => ({ ...v, site: e.detail }));
    };
    window.addEventListener("body-site", select);
    return () => window.removeEventListener("body-site", select);
  }, [kind]);
  const set = (f, value) =>
    setValues((v) => ({
      ...v,
      [f.key]: f.type === "number" && value !== "" ? Number(value) : value,
    }));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await request(`/v2/patients/${pid}/records`, "POST", {
        kind,
        data: values,
      });
      setSaved(true);
      setValues({});
      onSaved?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="stack care-record-form" onSubmit={submit}>
      <div className="row care-form-info"><span className="muted small">{spec.clinical ? "Clinical draft" : "Shared record"}</span><InfoButton title="Saving this record">
        {spec.clinical
          ? "Saved as a draft. Your treating doctor must review and sign before it becomes an active care plan."
          : "Saved to the shared patient folder with the author and time."}
      </InfoButton></div>
      {spec.fields.map((f) => (
        <label
          className={`field ${f.type === "checkbox" ? "care-check" : ""}`}
          key={f.key}
        >
          {f.type !== "checkbox" && (
            <span>
              {f.label}
              {f.required && " *"}
            </span>
          )}
          {f.type === "textarea" ? (
            <>
              <textarea
                className="input"
                rows={4}
                required={f.required}
                value={values[f.key] ?? ""}
                maxLength={20000}
                onChange={(e) => set(f, e.target.value)}
              />
              <Voice
                onText={(t) => set(f, `${values[f.key] || ""} ${t}`.trim())}
              />
            </>
          ) : f.type === "select" ? (
            <select
              className="select"
              required={f.required}
              value={values[f.key] ?? ""}
              onChange={(e) => set(f, e.target.value)}
            >
              <option value="">Choose…</option>
              {f.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : f.type === "checkbox" ? (
            <>
              <input
                type="checkbox"
                required={f.required}
                checked={values[f.key] || false}
                onChange={(e) => set(f, e.target.checked)}
              />
              <span>{f.label}</span>
            </>
          ) : (
            <input
              className="input"
              type={f.type}
              min={f.min}
              max={f.max}
              step={f.type === "number" ? "any" : undefined}
              required={f.required}
              value={values[f.key] ?? ""}
              onChange={(e) => set(f, e.target.value)}
            />
          )}
        </label>
      ))}
      {kind === "reminder" && (
        <AudioRecorder
          pid={pid}
          onSaved={(id) => setValues((v) => ({ ...v, audio_document_id: id }))}
        />
      )}
      <Error message={error} />
      {saved && (
        <p className="care-success" role="status">
          Saved to the patient folder{spec.clinical ? " as a draft" : ""}.
        </p>
      )}
      <button className="btn primary" disabled={busy}>
        {busy
          ? "Saving…"
          : spec.clinical
            ? "Save draft for review"
            : "Save to folder"}
      </button>
    </form>
  );
}

export function RecordCard({ record, user, onChange, onOpen }) {
  const [text, setText] = useState(record.data.text || ""),
    [grade, setGrade] = useState(0);
  const clinical = [
    "drug_protocol",
    "readiness",
    "takeaway",
    "roadmap",
    "scribe",
    "decision",
    "board_decision",
    "survivorship",
    "trial",
    "blood_card",
    "price_review",
    "integration_result",
  ].includes(record.kind);
  const sign = (action) =>
    request(`/v2/records/${record.id}/action`, "POST", {
      action,
      text,
      grade: Number(grade),
    });
  return (
    <article className="care-record">
      <div className="row wrap">
        <b>
          {nice(record.kind)} <small className="muted">R{record.id}</small>
        </b>
        <Status value={record.status} />
        <span className="spacer" />
        <small className="muted">
          {record.author_name} · {dateTime(record.created_at)}
        </small>
      </div>
      {Object.entries(record.data)
        .filter(([k]) => !["text", "result"].includes(k))
        .map(([key, value]) => (
          <p className="small" key={key}>
            <span className="muted">{nice(key)}: </span>
            {key === "document_id" || key === "audio_document_id" ? (
              <button className="src" onClick={() => onOpen?.(value)}>
                D{value}
              </button>
            ) : typeof value === "object" ? (
              JSON.stringify(value)
            ) : (
              String(value)
            )}
          </p>
        ))}
      {record.data.text && <p className="care-pre">{record.data.text}</p>}
      {record.kind === "integration_result" && (
        <pre className="care-pre small">
          {JSON.stringify(record.data.result, null, 2)}
        </pre>
      )}
      {record.kind === "blood_card" && record.status === "approved" && (
        <a
          className="btn"
          href={`https://wa.me/?text=${encodeURIComponent(`Blood bank coordination: ${record.data.blood_group}; ${record.data.hospital}; ${record.data.date}; contact ${record.data.contact}. ${record.data.text}`)}`}
          target="_blank"
          rel="noreferrer"
        >
          Share confirmed donor card on WhatsApp
        </a>
      )}
      {record.approved_by && (
        <p className="care-signed">
          Signed by {record.approved_by} · {dateTime(record.approved_at)}
        </p>
      )}
      {clinical && record.status === "draft" && user.role === "doctor" && (
        <div className="stack">
          <label className="field">
            Review and edit before signing
            <textarea
              className="input"
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <div className="row">
            <Action
              run={() => sign("approve")}
              onDone={onChange}
              className="btn primary"
            >
              Sign & release
            </Action>
            <Action run={() => sign("reject")} onDone={onChange}>
              Reject
            </Action>
          </div>
        </div>
      )}
      {record.kind === "photo_symptom" &&
        ["doctor", "nurse"].includes(user.role) && (
          <div className="row">
            <label className="field">
              Confirmed grade
              <select
                className="select"
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
              >
                {[0, 1, 2, 3, 4].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <Action run={() => sign("confirm_grade")} onDone={onChange}>
              Confirm grade
            </Action>
          </div>
        )}
      {["task", "reminder", "handover", "chair"].includes(record.kind) &&
        record.status !== "completed" && (
          <Action run={() => sign("complete")} onDone={onChange}>
            Mark complete
          </Action>
        )}
    </article>
  );
}
