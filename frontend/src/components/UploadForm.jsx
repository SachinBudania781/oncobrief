import { useEffect, useRef, useState } from "react";
import {
  QrCode,
  Camera,
  Upload,
  CheckCircle2,
  Loader2,
  FileText,
} from "lucide-react";
import { api, nowLocalInput } from "../api";
import QrScanner from "./QrScanner";

/**
 * The ONE upload flow used by every app: pick type first, then the file.
 * The backend refuses anything without patient, category, subtype and date — that is what
 * makes AI sorting unnecessary.
 */
export default function UploadForm({
  taxonomy,
  mode = "staff",
  fixedPatientId,
  department,
  onUploaded,
  compact,
}) {
  const deptInfo = taxonomy.departments.find((d) => d.name === department);
  const defaultCat =
    mode === "patient"
      ? "Patient-reported"
      : deptInfo?.default_category || "Lab report";
  const [pid, setPid] = useState(fixedPatientId || "");
  const [patient, setPatient] = useState(null);
  const [pidErr, setPidErr] = useState("");
  const [category, setCategory] = useState(defaultCat);
  const [subtype, setSubtype] = useState(
    taxonomy.categories[defaultCat].subtypes[0],
  );
  const [when, setWhen] = useState(nowLocalInput());
  const [title, setTitle] = useState("");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [drag, setDrag] = useState(false);
  const [qr, setQr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState(null);
  const [manualLabs, setManualLabs] = useState(false);
  const [labs, setLabs] = useState({});
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const [identityReason, setIdentityReason] = useState("");
  const camera = useRef(null);

  useEffect(() => {
    setCategory(defaultCat);
    setSubtype(taxonomy.categories[defaultCat].subtypes[0]);
  }, [defaultCat, taxonomy]);
  useEffect(() => {
    if (fixedPatientId) setPid(fixedPatientId);
  }, [fixedPatientId]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  useEffect(() => {
    if (!pid || pid.length < 8) {
      setPatient(null);
      setPidErr("");
      return;
    }
    const t = setTimeout(() => {
      api
        .patient(pid)
        .then((p) => {
          setPatient(p);
          setPidErr("");
        })
        .catch(() => {
          setPatient(null);
          setPidErr("No patient with this ID");
        });
    }, 250);
    return () => clearTimeout(t);
  }, [pid]);

  const pick = (f) => {
    if (!f) return;
    setFile(f);
    setResult(null);
    setPreview(f.type.startsWith("image/") ? URL.createObjectURL(f) : "");
  };
  const submit = async (e) => {
    e.preventDefault();
    if (!patient) {
      setErr("Enter a valid patient ID first.");
      return;
    }
    if (!file) {
      setErr("Choose a file or scan a page.");
      return;
    }
    setBusy(true);
    setErr("");
    const form = new FormData();
    form.append("patient_id", patient.id);
    form.append("category", category);
    form.append("subtype", subtype);
    form.append("record_date", when);
    form.append("title", title);
    form.append(
      "department",
      mode === "patient" ? "Patient" : department || "",
    );
    form.append(
      "source",
      mode === "patient" ? "patient" : "staff",
    );
    const entered = Object.entries(labs)
      .filter(([, v]) => v !== "" && v != null)
      .map(([test, value]) => ({ test, value: Number(value) }));
    if (manualLabs && entered.length)
      form.append("lab_values", JSON.stringify(entered));
    form.append("file", file);
    form.append("identity_confirmed", String(identityConfirmed));
    form.append("identity_reason", identityReason);
    try {
      const doc = await api.upload(form);
      setResult(doc);
      onUploaded?.(doc);
      setFile(null);
      setPreview("");
      setTitle("");
      setLabs({});
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  const subtypes = taxonomy.categories[category].subtypes;
  return (
    <form onSubmit={submit} className="stack">
      {!fixedPatientId && (
        <label className="field">
          <span>Patient ID</span>
          <div className="row">
            <input
              className="input"
              value={pid}
              onChange={(e) => setPid(e.target.value.toUpperCase())}
              placeholder="OB-2026-0001"
            />
            <button type="button" className="btn" onClick={() => setQr(true)}>
              <QrCode size={16} /> Scan QR
            </button>
          </div>
          {patient && (
            <p className="small" style={{ marginTop: 6, color: "var(--ok)" }}>
              <CheckCircle2 size={14} style={{ verticalAlign: -2 }} />{" "}
              {patient.name}, {patient.age}
              {patient.sex} — {patient.cancer_type}
            </p>
          )}
          {pidErr && (
            <p
              className="small"
              style={{ marginTop: 6, color: "var(--critical)" }}
            >
              {pidErr}
            </p>
          )}
        </label>
      )}
      <div className="grid2">
        <label className="field">
          <span>Document type</span>
          <select
            className="select"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setSubtype(taxonomy.categories[e.target.value].subtypes[0]);
            }}
          >
            {Object.keys(taxonomy.categories).map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Which one</span>
          <select
            className="select"
            value={subtype}
            onChange={(e) => setSubtype(e.target.value)}
          >
            {subtypes.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid2">
        <label className="field">
          <span>Date and time on the report</span>
          <input
            type="datetime-local"
            className="input"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            required
          />
        </label>
        {!compact && (
          <label className="field">
            <span>Title (optional)</span>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={`${subtype} report`}
            />
          </label>
        )}
      </div>

      <div className="care-capture-row"><span>Document capture</span><button type="button" className="btn" onClick={() => camera.current?.click()}><Camera size={17} />Take a photo</button><input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={e => pick(e.target.files?.[0])} /></div>
      <label
        className={`dropzone ${drag ? "drag" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          pick(e.dataTransfer.files?.[0]);
        }}
      >
        <input
          type="file"
          accept=".pdf,image/*"
          className="sr-only"
          onChange={(e) => pick(e.target.files?.[0])}
        />
        {file ? (
          <div className="stack">
            {preview ? (
              <img src={preview} alt="Selected page" />
            ) : (
              <FileText size={40} color="var(--plum)" />
            )}
            <div className="small">
              <b>{file.name}</b> · {(file.size / 1024).toFixed(0)} KB · tap to
              change
            </div>
          </div>
        ) : (
          <div className="stack">
            <Upload size={26} color="var(--plum)" />
            <div>
              <b>
                {mode === "patient"
                  ? "Take a photo or choose a file"
                  : "Drop a PDF or image here"}
              </b>
            </div>
            <div className="small muted">PDF, JPG or PNG, up to 15 MB</div>
          </div>
        )}
      </label>

      {category === "Lab report" && (
        <div>
          <label className="row small" style={{ cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={manualLabs}
              onChange={(e) => setManualLabs(e.target.checked)}
            />
            Type the values myself (otherwise they are read from the report and
            shown for checking)
          </label>
          {manualLabs && (
            <div className="row wrap lab-table" style={{ marginTop: 8 }}>
              {(subtype === "CBC"
                ? ["Haemoglobin", "WBC", "ANC", "Platelets"]
                : subtype === "LFT"
                  ? ["Bilirubin", "ALT", "AST", "Albumin"]
                  : subtype === "KFT / RFT"
                    ? ["Creatinine", "Sodium", "Potassium"]
                    : ["CEA", "CA 15-3"]
              ).map((t) => (
                <label key={t} className="field">
                  <span>
                    {t} <span className="muted">{taxonomy.lab_tests[t]}</span>
                  </span>
                  <input
                    className="input"
                    type="number"
                    step="any"
                    value={labs[t] ?? ""}
                    onChange={(e) => setLabs({ ...labs, [t]: e.target.value })}
                  />
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      <label className="care-check">
        <input
          type="checkbox"
          checked={identityConfirmed}
          onChange={(e) => setIdentityConfirmed(e.target.checked)}
        />
        I checked the original and verified the patient's identity if OCR cannot
        read it.
      </label>
      {identityConfirmed && (
        <label className="field">
          <span>How was identity verified? (at least 10 characters)</span>
          <input
            className="input"
            minLength={10}
            required
            value={identityReason}
            onChange={(e) => setIdentityReason(e.target.value)}
          />
        </label>
      )}
      {err && (
        <p className="small" style={{ color: "var(--critical)" }}>
          {err}
        </p>
      )}
      <button className="btn primary lg" type="submit" disabled={busy}>
        {busy ? (
          <>
            <Loader2 size={18} className="spin" /> Filing and reading the
            document…
          </>
        ) : (
          <>File to patient folder</>
        )}
      </button>

      {result && (
        <div className="filed stack" role="status">
          <div className="row">
            <CheckCircle2 size={18} color="var(--ok)" />
            <b>
              Filed as {result.tag}: {result.category} / {result.subtype}
            </b>
          </div>
          <div className="small">
            Saved to <code>{result.folder_path}</code>
          </div>
          <div className="small">
            {result.ocr_method === "pdf-text"
              ? "Text read from the PDF."
              : `OCR read the page with ${result.ocr_confidence ?? "–"}% confidence.`}
            {result.lab_values?.length > 0 &&
              (result.lab_values_auto_parsed
                ? " Values read from the report — please check:"
                : " Values saved:")}
          </div>
          {result.lab_values?.length > 0 && (
            <div className="row wrap">
              {result.lab_values.map((l) => (
                <span
                  key={l.test}
                  className={`chip ${l.flag ? "critical" : "ok"}`}
                >
                  {l.test} {l.value} {l.flag && `(${l.flag})`}
                </span>
              ))}
            </div>
          )}
          <p className="tiny muted">
            The doctor's next brief for this patient will include it.
          </p>
        </div>
      )}
      {qr && (
        <QrScanner
          onClose={() => setQr(false)}
          onResult={(id) => {
            setQr(false);
            setPid(id);
          }}
        />
      )}
    </form>
  );
}
