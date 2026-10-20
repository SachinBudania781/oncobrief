import { useEffect, useState } from "react";
import { ArrowUpRight, FileText, Search } from "lucide-react";
import { api, fmtDate, CATEGORY_COLORS } from "../../api";

function highlight(text, q) {
  if (!q || !text) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

// Pull any specific report by type, date range, or words inside it (OCR text is searchable too).
export default function Records({ patientId, taxonomy, onOpen }) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [subtype, setSubtype] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    const t = setTimeout(() => {
      api
        .documents(patientId, {
          q,
          category,
          subtype,
          date_from: from,
          date_to: to,
        })
        .then((v) => {
          if (live) setRows(v);
        })
        .catch((e) => {
          if (live) setError(e.message);
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [patientId, q, category, subtype, from, to]);

  return (
    <div>
      {error && (
        <p className="care-error" role="alert">
          {error}
        </p>
      )}
      <div className="records-filters">
        <label className="field">
          <span>Words in the report</span>
          <div style={{ position: "relative" }}>
            <Search
              size={16}
              style={{
                position: "absolute",
                left: 10,
                top: 12,
                color: "var(--ink-3)",
              }}
            />
            <input
              className="input"
              style={{ paddingLeft: 32 }}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="e.g. neutrophil, EGFR, impression"
            />
          </div>
        </label>
        <label className="field">
          <span>Type</span>
          <select
            className="select"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setSubtype("");
            }}
          >
            <option value="">All types</option>
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
            disabled={!category}
          >
            <option value="">All</option>
            {category &&
              taxonomy.categories[category].subtypes.map((s) => (
                <option key={s}>{s}</option>
              ))}
          </select>
        </label>
        <label className="field">
          <span>From</span>
          <input
            type="date"
            className="input"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="field">
          <span>To</span>
          <input
            type="date"
            className="input"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
      </div>
      <div className="records-mobile-list" aria-label="Patient reports">{rows.map(d => <button className="records-mobile-card" key={d.id} onClick={() => onOpen(d.tag)}><span className="records-mobile-icon"><FileText size={21} /></span><span className="records-mobile-copy"><small>{d.subtype} <span>· {fmtDate(d.record_date)}</span></small><b>{d.title}</b>{d.snippet && <span className="records-mobile-snippet">{highlight(d.snippet,q)}</span>}<em>{d.external_hospital || (d.source === "patient" ? "Patient app" : "This hospital")}</em></span><ArrowUpRight size={16} /></button>)}{loading && <p className="care-loading" role="status">Loading reports…</p>}{!loading && !rows.length && <div className="care-empty">No matching reports.</div>}</div>
      <div className="panel records-desktop-table" style={{ padding: 0, overflowX: "auto" }}>
        <table className="list">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Document</th>
              <th>From</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} className="click" tabIndex={0} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(d.tag); } }} onClick={() => onOpen(d.tag)}>
                <td className="num" style={{ whiteSpace: "nowrap" }}>
                  {fmtDate(d.record_date)}
                </td>
                <td>
                  <span className="row">
                    <i
                      className="dot"
                      style={{
                        background: CATEGORY_COLORS[d.category],
                        borderRadius: 3,
                      }}
                    />
                    {d.subtype}
                  </span>
                </td>
                <td>
                  <b>{d.title}</b> <span className="src static">{d.tag}</span>
                  {d.snippet && (
                    <div className="small muted">
                      …{highlight(d.snippet, q)}…
                    </div>
                  )}
                </td>
                <td className="small">
                  {d.external_hospital ||
                    (d.source === "patient" ? "Patient app" : "This hospital")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && rows.length === 0 && (
          <div className="empty">
            No documents match. Clear a filter to widen the search.
          </div>
        )}
      </div>
    </div>
  );
}
