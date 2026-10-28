import { useEffect, useState } from "react";
import {
  CalendarDays,
  MapPin,
  QrCode,
  ScanLine,
  Upload,
  ArrowRight,
} from "lucide-react";
import { request, useResource, dateTime } from "./client";
import { Action, Empty, Error, Load, Panel, Status } from "./UI";
import UploadForm from "../components/UploadForm";
import Records from "../apps/doctor/Records";

export function RecordsDesk({ pid, user, onOpen }) {
  const taxonomy = useResource("/taxonomy"),
    [version, setVersion] = useState(0);
  const [department, setDepartment] = useState(
    user.department || "Biochemistry & Haematology Lab",
  );
  const staffUpload = ["doctor", "nurse", "lab", "admin"].includes(user.role);
  return (
    <div className="stack">
      <Panel
        title="Original records"
        hint="Every explanation can be checked against the original document. Access is logged and files are watermarked."
      >
        <Load resource={taxonomy}>
          {(t) => (
            <Records
              key={`${pid}-${version}`}
              patientId={pid}
              taxonomy={t}
              onOpen={(tag) => onOpen(Number(tag.slice(1)))}
            />
          )}
        </Load>
      </Panel>
      {["patient", "caregiver", "doctor", "nurse", "lab", "admin"].includes(
        user.role,
      ) && (
        <>
          <Panel
            title="Upload to this patient's folder"
            hint="The printed patient identity is checked before filing. Unreadable identity needs an explicit manual verification."
          >
            <Load resource={taxonomy}>
              {(t) => (
                <div className="stack">
                  {staffUpload && <label className="field"><span>Filing department</span><select className="select" value={department} onChange={(e) => setDepartment(e.target.value)}>{t.departments.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}</select></label>}
                  <UploadForm
                    key={pid}
                    taxonomy={t}
                    mode={
                      ["patient", "caregiver"].includes(user.role)
                        ? "patient"
                        : "staff"
                    }
                    fixedPatientId={pid}
                    department={staffUpload ? department : "Patient"}
                    onUploaded={() => setVersion((v) => v + 1)}
                  />
                </div>
              )}
            </Load>
          </Panel>
        </>
      )}
      {["doctor", "nurse", "lab", "admin"].includes(user.role) && (
        <BulkImport pid={pid} taxonomy={taxonomy.data} />
      )}
    </div>
  );
}

function BulkImport({ pid, taxonomy }) {
  const [file, setFile] = useState(null),
    [bundle, setBundle] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState(null);
  const setPage = (index, key, value) =>
    setBundle((b) => ({
      ...b,
      pages: b.pages.map((p, i) => (i === index ? { ...p, [key]: value } : p)),
    }));
  return (
    <Panel
      title="Whole-file intake"
      hint="Up to 100 pages. OCR suggests filing tags per page; staff review, group and confirm every page before documents are filed."
    >
      <form
        className="row wrap"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          setBusy(true);
          try {
            const f = new FormData();
            f.append("file", file);
            const b = await request(
              `/v2/patients/${pid}/bulk-import`,
              "POST",
              f,
            );
            setBundle({
              ...b,
              pages: b.pages.map((p) => ({
                ...p,
                identity_confirmed: false,
                identity_reason: "",
              })),
            });
            setResult(null);
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <input
          type="file"
          accept="application/pdf"
          required
          onChange={(e) => setFile(e.target.files[0])}
        />
        <button className="btn" disabled={busy}>
          {busy ? "Reading every page…" : "Read bundle for review"}
        </button>
      </form>
      <Error message={error} />
      {bundle && !result && (
        <div className="stack">
          {bundle.pages.map((p, i) => (
            <details key={i} className="care-record">
              <summary>
                Page {p.page + 1} · {p.category} · {p.date || "date needed"}
              </summary>
              <pre className="care-pre small">
                {p.text || "No OCR text; read the original bundle."}
              </pre>
              <div className="grid2">
                <label className="field">
                  Group number
                  <input
                    className="input"
                    type="number"
                    min="1"
                    value={p.group}
                    onChange={(e) =>
                      setPage(i, "group", Number(e.target.value))
                    }
                  />
                </label>
                <label className="field">
                  Date
                  <input
                    className="input"
                    type="date"
                    value={p.date}
                    onChange={(e) => setPage(i, "date", e.target.value)}
                  />
                </label>
                <label className="field">
                  Category
                  <select
                    className="select"
                    value={p.category}
                    onChange={(e) => {
                      setPage(i, "category", e.target.value);
                      setPage(
                        i,
                        "subtype",
                        taxonomy.categories[e.target.value].subtypes[0],
                      );
                    }}
                  >
                    {Object.keys(taxonomy?.categories || {}).map((k) => (
                      <option key={k}>{k}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Subtype
                  <select
                    className="select"
                    value={p.subtype}
                    onChange={(e) => setPage(i, "subtype", e.target.value)}
                  >
                    {taxonomy?.categories[p.category]?.subtypes.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="field">
    