import { useEffect, useState } from "react";
import {
  Line,
  LineChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
  Legend,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  Check,
  Phone,
  Play,
  Volume2,
} from "lucide-react";
import { request, useResource, dateTime, nice, speak } from "./client";
import {
  Action,
  Empty,
  Error,
  Load,
  InfoButton,
  Panel,
  SourceLinks,
  Status,
  Voice,
} from "./UI";

export function AlertConsole({ onSelect }) {
  const alerts = useResource("/v2/alerts", 10000);
  const [outcomes, setOutcomes] = useState({});
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <Panel
      title="Nurse triage & golden-hour console"
      hint="Fixed rules create alerts. Record calls and escalation here. External phone/SMS delivery requires configuration."
    >
      <Load resource={alerts}>
        {(items) =>
          items.length ? (
            items.map((a) => (
              <article className={`care-alert ${a.severity}`} key={a.id}>
                <div className="row wrap">
                  <AlertTriangle size={20} />
                  <button
                    className="care-link"
                    onClick={() => onSelect(a.patient_id)}
                  >
                    <b>{a.patient_name}</b>
                  </button>
                  <Status value={a.status} />
                  <span className="spacer" />
                  <span className="small">{dateTime(a.created_at)}</span>
                </div>
                <h3>{a.reason}</h3>
                <p className="small">{a.call_script}</p>
                <p className="small muted">{a.ladder.join(" → ")}</p>
                {a.severity === "emergency" && (
                  <div className="care-clock">
                    {a.arrival_at ? (
                      <>
                        <b>
                          {Math.max(
                            0,
                            60 -
                              Math.floor(
                                (now - new Date(a.arrival_at).getTime()) /
                                  60000,
                              ),
                          )}{" "}
                          min
                        </b>{" "}
                        remaining to the 60-minute target from recorded ER
                        arrival
                      </>
                    ) : (
                      "ER arrival not yet recorded. The antibiotic target clock starts at arrival."
                    )}
                  </div>
                )}
                {a.outcome && <pre className="care-pre small">{a.outcome}</pre>}
                {a.status !== "resolved" && (
                  <>
                    <label className="field">
                      Call / escalation outcome
                      <input
                        className="input"
                        minLength={3}
                        value={outcomes[a.id] || ""}
                        onChange={(e) =>
                          setOutcomes((v) => ({ ...v, [a.id]: e.target.value }))
                        }
                        placeholder="Record the action and who was contacted"
                      />
                    </label>
                    <div className="row wrap">
                      {[
                        "acknowledge",
                        "call",
                        "escalate",
                        "arrived",
                        "resolve",
                      ].map((action) => (
                        <Action
                          key={action}
                          run={() =>
                            request(`/v2/alerts/${a.id}/action`, "POST", {
                              action,
                              outcome: outcomes[a.id] || "",
                            })
                          }
                          onDone={alerts.refresh}
                        >
                          {nice(action)}
                        </Action>
                      ))}
                    </div>
                  </>
                )}
              </article>
            ))
          ) : (
            <Empty>No alerts have been recorded.</Empty>
          )
        }
      </Load>
    </Panel>
  );
}

export function ApprovalQueue({ pid, onUpdate }) {
  const resource = useResource(`/v2/patients/${pid}/approvals`, 12000);
  return (
    <Panel
      title="Doctor approval queue"
      hint="Specify, check, edit and sign. Patients cannot see the clinical draft until approval."
    >
      <Load resource={resource}>
        {(items) =>
          items.length ? (
            items.map((a) => (
              <ApprovalReview
                key={a.id}
                approval={a}
                onDone={() => {
                  resource.refresh();
                  onUpdate?.();
                }}
              />
            ))
          ) : (
            <Empty>No medicine or clinical requests waiting.</Empty>
          )
        }
      </Load>
    </Panel>
  );
}

function ApprovalReview({ approval: a, onDone }) {
  const [v, setV] = useState({
    action: "approve",
    medicine: "",
    dose: "",
    frequency: "",
    times: "08:00,20:00",
    instructions: "",
    reason: "",
    evidence_url: "",
    safety_confirmed: false,
  });
  const [checks, setChecks] = useState(null);
  const body = (action) => ({
    ...v,
    action,
    times: v.times
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  });
  const review = (action) =>
    request(`/v2/approvals/${a.id}/review`, "POST", body(action));
  return (
    <article className="care-record">
      <div className="row wrap">
        <b>
          Request #{a.id} · {a.request}
        </b>
        <Status value={a.status} />
      </div>
      <p className="small muted">
        {a.requested_by} · {dateTime(a.created_at)}
      </p>
      {a.draft?.text && <p>{a.draft.text}</p>}
      {["sent", "reviewing"].includes(a.status) ? (
        <div className="stack">
          {a.kind === "medicine" && (
            <>
              <div className="grid2">
                {[
                  ["medicine", "Generic medicine"],
                  ["dose", "Dose"],
                  ["frequency", "Frequency"],
                  ["times", "Reminder times (comma-separated HH:MM)"],
                ].map(([key, label]) => (
                  <label key={key} className="field">
                    {label}
                    <input
                      className="input"
                      value={v[key]}
                      onChange={(e) => setV({ ...v, [key]: e.target.value })}
                    />
                  </label>
                ))}
              </div>
              <label className="field">
                Instructions
                <textarea
                  className="input"
                  value={v.instructions}
                  onChange={(e) => setV({ ...v, instructions: e.target.value })}
                />
              </label>
            </>
          )}
          <label className="field">
            Guideline / protocol source URL
            <input
              className="input"
              type="url"
              value={v.evidence_url}
              onChange={(e) => setV({ ...v, evidence_url: e.target.value })}
            />
          </label>
          <label className="field">
            Decision and clinical rationale
            <textarea
              className="input"
              value={v.reason}
              onChange={(e) => setV({ ...v, reason: e.target.value })}
            />
          </label>
          <Action
            run={() =>
              request(`/v2/approvals/${a.id}/checks`, "POST", body("approve"))
            }
            onDone={setChecks}
          >
            Run screening checks
          </Action>
          {checks && (
            <div className="care-notice">
              <p>
                BSA: {checks.bsa_m2 ?? "not recorded"} m² · eGFR:{" "}
                {checks.egfr ?? "not recorded"}
              </p>
              {checks.issues.length ? (
                checks.issues.map((issue) => <p key={issue}>• {issue}</p>)
              ) : (
                <p>No flag in the limited screening rules.</p>
              )}
              <p className="small">{checks.scope}</p>
              <p className="small">
                Active: {checks.active_medicines.join(", ")}
              </p>
            </div>
          )}
          <label className="care-check">
            <input
              type="checkbox"
              checked={v.safety_confirmed}
              onChange={(e) =>
                setV({ ...v, safety_confirmed: e.target.checked })
              }
            />
            I verified allergies, interactions, dose, body size, kidney function
            and the local protocol; my rationale addresses any flags.
          </label>
          <div className="row wrap">
            <Action run={() => review("reviewing")} onDone={onDone}>
              Mark reviewing
            </Action>
            <Action
              className="btn primary"
              run={() => review("approve")}
              onDone={onDone}
            >
              Sign & release
            </Action>
            <Action run={() => review("reject")} onDone={onDone}>
              Reject
            </Action>
          </div>
        </div>
      ) : (
        <p className="care-signed">
          {a.status} by {a.reviewed_by} · {a.reason}
        </p>
      )}
    </article>
  );
}

export function ClinicalChart({ pid, onOpen, user }) {
  const resource = useResource(`/v2/patients/${pid}/clinical`),
    labs = useResource(`/patients/${pid}/labs`);
  const [test, setTest] = useState("Haemoglobin"),
    [month, setMonth] = useState(100),
    [replay, setReplay] = useState(false);
  useEffect(() => {
    if (!replay) return;
    setMonth(0);
    const t = setInterval(
      () =>
        setMonth((n) => {
          if (n >= 100) {
            setReplay(false);
            return 100;
          }
          return n + 5;
        }),
      1000,
    );
    return () => clearInterval(t);
  }, [replay]);
  return (
    <Load resource={resource}>
      {(d) => (
        <div className="stack">
          <Panel
            title="Treatment roadmap"
            action={
              <button
                className="btn"
                onClick={() =>
                  speak(d.roadmap.text || "No signed roadmap available.")
                }
              >
                Listen
              </button>
            }
          >
            {Object.keys(d.roadmap).length ? (
              <>
                <div className="care-roadmap">
                  <span className="care-pill">YOU ARE HERE</span>
                  <h2>
                    Cycle {d.roadmap.cycle || "—"} of{" "}
                    {d.roadmap.total_cycles || "—"}
                  </h2>
                  <p>{d.roadmap.regimen}</p>
                  <div className="care-cycles">
                    {Array.from(
                      { length: Math.min(d.roadmap.total_cycles || 1, 20) },
                      (_, i) => (
                        <span
                          key={i}
                          className={
                            i + 1 <= (d.roadmap.cycle || 0) ? "complete" : ""
                          }
                        >
                          {i + 1}
                        </span>
                      ),
                    )}
                  </div>
                  <div className="row small muted">Plan notes<InfoButton title="Roadmap notes"><p>{d.roadmap.text}</p><p>{d.roadmap.side_effect_days}</p></InfoButton></div>
                </div>
              </>
            ) : (
              <Empty>The treating doctor has not signed a roadmap yet.</Empty>
            )}
          </Panel>
          <div className="care-columns">
            <Panel
              title="Body map & journey replay"
              hint="Confirmed measurements and patient pain reports. Slider filters recorded dates."
              action={
                <button className="btn" onClick={() => setReplay((v) => !v)}>
                  <Play size={15} />
                  {replay ? "Pause" : "20-second replay"}
                </button>
              }
            >
              <BodyMap measurements={d.measurements} month={month} />
              <JourneyReplay
                events={d.journey || []}
                progress={month}
                onOpen={onOpen}
              />
              <input
                aria-label="Journey time slider"
                type="range"
                min="0"
                max="100"
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
              />
              <p className="small muted">
                {month}% through the recorded journey.
              </p>
            </Panel>
            <Panel title="Response & lab trends" hint="Tap a sourced value to open its report. Confirmed tumour measurements are separate from raw extraction suggestions. Body sites and sizes require clinician confirmation.">
              <select
                className="select"
                value={test}
                onChange={(e) => setTest(e.target.value)}
              >
                {Object.keys(labs.data || {}).map((t) => (
                  <option key={t}>{t}</option>
                ))}
                <option value="tumour_mm">Confirmed tumour size (mm)</option>
              </select>
              <div className="care-chart">
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart
                    data={
                      test === "tumour_mm"
                        ? d.measurements.map((r) => ({
                            date: r.data.date,
                            value: r.data.size_mm,
                            document_id: r.data.document_id,
                          }))
                        : labs.data?.[test] || []
                    }
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(x) =>
                        new Date(x).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                        })
                      }
                    />
                    <YAxis />
                    <Tooltip />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="#4393a5"
                      strokeWidth={3}
                      connectNulls={false}
                      dot={{ r: 5 }}
                      activeDot={{
                        onClick: (_, d) =>
                          d.payload?.document_id &&
                          onOpen(d.payload.document_id),
                      }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </div>
          <Panel
            title="Pain map over time"
            hint="Patient-reported pain, filtered by the journey slider."
          >
            <BodyMap measurements={d.pain || []} month={month} />
          </Panel>
          <Panel
            title="This cycle: forecast vs reality"
            hint="Forecast uses the same patient's previous cycle days. Missing history stays blank."
          >
            <div className="care-chart">
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={d.forecast}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" />
                  <YAxis domain={[0, 8]} />
                  <Tooltip />
                  <Legend />
                  <Line
                    dataKey="expected"
                    stroke="#96bdc6"
                    strokeDasharray="5 5"
                    connectNulls={false}
                  />
                  <Line
                    dataKey="actual"
                    stroke="#5c9ac3"
                    strokeWidth={3}
                    connectNulls={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            {!d.forecast.some((x) => x.expected != null) && (
              <p className="small muted">
                Not enough previous-cycle observations to estimate a personal
                forecast.
              </p>
            )}
          </Panel>
          {user.role === "doctor" && (
            <>
              <Panel
                title="Chemo-day readiness"
                hint="Decision stays with the treating doctor. Configure signed local thresholds in the protocol form."
              >
                <table className="list">
                  <thead>
                    <tr>
                      <th>Test</th>
                      <th>Latest</th>
                      <th>Check</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.readiness.map((r) => (
                      <tr key={r.test}>
                        <td>{r.test}</td>
                        <td>
                          {r.lab ? `${r.lab.value} ${r.lab.unit}` : "Missing"}
                        </td>
                        <td>{r.result}</td>
                        <td>
                          {r.lab?.source?.startsWith("D") && (
                            <button
                              className="src"
                              onClick={() =>
                                onOpen(Number(r.lab.source.slice(1)))
                              }
                            >
                              {r.lab.source}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="care-notice">
                  Heart assessment, cumulative exposure and current clinical
                  condition must also be checked. {d.readiness_status}.
                </p>
                <ReadinessProtocol pid={pid} onDone={resource.refresh} />
              </Panel>
              <div className="care-columns">
                <Panel title="Lifetime cumulative doses">
                  {d.cumulative.length ? (
                    d.cumulative.map((c, i) => (
                      <p className={c.warning ? "care-error" : ""} key={i}>
                        {c.drug}:{" "}
                        <b>
                          {c.total} {c.unit}
                        </b>
                        {c.limit && ` / ${c.limit} individual limit`}
                      </p>
                    ))
                  ) : (
                    <Empty>
                      No administration records. Add verified doses in Plans &
                      journal.
                    </Empty>
                  )}
                  <p className="small muted">
                    Totals include recorded entries only; missing lifetime
                    exposure must be reconciled.
                  </p>
                </Panel>
                <Panel title="Personal-baseline changes">
                  {d.baselines.length ? (
                    d.baselines.map((b) => (
                      <p key={b.test}>
                        {b.test}: {b.latest}, compared with {b.previous_mean}{" "}
                        over the preceding three readings.{" "}
                        <button
                          className="src"
                          onClick={() => onOpen(Number(b.source.slice(1)))}
                        >
                          {b.source}
                        </button>
                      </p>
                    ))
                  ) : (
                    <Empty>
                      No marked decline against the preceding three readings.
                    </Empty>
                  )}
                </Panel>
              </div>
              <Panel title="Imaging extraction review">
                {d.extracted_measurements.length ? (
                  d.extracted_measurements.map((m, i) => (
                    <p key={i}>
                      {m.text} → {m.size_mm} mm{" "}
                      <button
                        className="src"
                        onClick={() => onOpen(m.document_id)}
                      >
                        D{m.document_id}
                      </button>
                      <span className="care-status">
                        Needs clinician confirmation
                      </span>
                    </p>
                  ))
                ) : (
                  <Empty>
                    No rule-based size candidates found. Enter confirmed
                    measurements in Plans & journal.
                  </Empty>
                )}
              </Panel>
              <Panel title="What changed since the previous report">
                {d.changes.map((c) => (
                  <details key={c.subtype}>
                    <summary>
                      {c.subtype} · {c.from} → {c.to}
                    </summary>
                    <pre className="care-diff">
                      {c.lines.map((l, i) => (
                        <div
                          key={i}
                          className={
                            l.startsWith("+")
                              ? "added"
                              : l.startsWith("-")
                                ? "removed"
                                : ""
                          }
                        >
                          {l}
                        </div>
                      ))}
                    </pre>
                  </details>
                ))}
              </Panel>
              <Panel title="Evidence behind suggestions" hint="Drafts stay in Doctor approvals until the treating clinician reviews and signs them. Linked guidelines provide context for the treating team; demo outcomes are never used as evidence.">
                <Action
                  className="btn primary"
                  run={() =>
                    request(`/v2/patients/${pid}/care-review-draft`, "POST")
                  }
                  onDone={() => {}}
                >
                  Draft a care review for the approval queue
                </Action>
                <div className="row small muted">{d.evidence.cohort ? "Local evidence" : "Local evidence unavailable"}<InfoButton title="Local evidence">{d.evidence.note}</InfoButton></div>
                {d.evidence.cohort && (
                  <pre className="care-pre">
                    {JSON.stringify(d.evidence.cohort, null, 2)}
                  </pre>
                )}
                <a href={d.evidence.guideline} target="_blank" rel="noreferrer">
                  NCI treatment information
                </a>
              </Panel>
            </>
          )}
        </div>
      )}
    </Load>
  );
}

const sites = {
  head: [100, 38],
  chest: [100, 97],
  left_breast: [125, 106],
  right_breast: [75, 106],
  abdomen: [100, 150],
  pelvis: [100, 200],
  left_arm: [152, 155],
  right_arm: [48, 155],
  left_leg: [122, 280],
  right_leg: [78, 280],
};
export function BodyMap({ measurements = [], month = 100, onSite }) {
  const sorted = [...measurements].sort((a, b) =>
    String(a.data.date || a.created_at).localeCompare(
      String(b.data.date || b.created_at),
    ),
  );
  const first = sorted.length
    ? new Date(sorted[0].data.date || sorted[0].created_at).getTime()
    : 0;
  const last = sorted.length
    ? new Date(
        sorted[sorted.length - 1].data.date ||
          sorted[sorted.length - 1].created_at,
      ).getTime()
    : 0;
  const cutoff = first + ((last - first) * month) / 100;
  const visible = sorted.filter(
    (r) => new Date(r.data.date || r.created_at).getTime() <= cutoff,
  );
  const latest = Object.fromEntries(visible.map((r) => [r.data.site, r]));
  return (
    <div className="care-bodymap">
      <svg viewBox="0 0 200 350" role="img" aria-label="Body map">
        <circle cx="100" cy="35" r="25" fill="#e9f4f6" stroke="#a5cad2" />
        <path
          d="M74 70 Q100 58 126 70 L151 143 Q156 159 146 165 L126 111 L128 195 L143 319 Q141 337 128 330 L104 224 L96 224 L72 330 Q58 337 57 319 L72 195 L74 111 L54 165 Q43 159 49 143Z"
          fill="#e9f4f6"
          stroke="#a5cad2"
          strokeWidth="2"
        />
        {Object.entries(sites).map(([site, [x, y]]) => (
          <g
            key={site}
            role={onSite ? "button" : undefined}
            tabIndex={onSite ? 0 : undefined}
            onClick={() => onSite?.(site)}
            onKeyDown={(e) => e.key === "Enter" && onSite?.(site)}
            aria-label={nice(site)}
          >
            <circle
              cx={x}
              cy={y}
              r={
                latest[site]
                  ? Math.max(
                      7,
                      Math.min(
                        20,
                        (latest[site].data.size_mm ||
                          latest[site].data.score * 3 ||
                          10) / 2,
                      ),
                    )
                  : onSite
                    ? 8
                    : 0
              }
              fill={latest[site] ? "#d56579" : "#70b6c6"}
              fillOpacity=".65"
              stroke="#fff"
            />
            <title>
              {nice(site)}:{" "}
              {latest[site]
                ? latest[site].data.size_mm
                  ? `${latest[site].data.size_mm} mm`
                  : `Pain ${latest[site].data.score}/10`
                : "Tap to record"}
            </title>
          </g>
        ))}
      </svg>
      <div>
        {Object.values(latest).map((r) => (
          <p className="small" key={r.id}>
            <b>{nice(r.data.site)}</b> ·{" "}
            {r.data.size_mm != null
              ? `${r.data.size_mm} mm`
              : `pain ${r.data.score}/10`}
            <br />
            <span className="muted">
              {r.data.date || dateTime(r.created_at)}
            </span>
          </p>
        ))}
        {!visible.length && (
          <p className="small muted">No findings at this point.</p>
        )}
      </div>
    </div>
  );
}

function ReadinessProtocol({ pid, onDone }) {
  const [text, setText] = useState(
      '{"ANC":{"min":1.5},"Platelets":{"min":100}}',
    ),
    [source, setSource] = useState(""),
    [rationale, setRationale] = useState("");
  return (
    <details>
      <summary>Sign a patient-specific local readiness protocol</summary>
      <div className="stack">
        <p className="small muted">
          Values below are editable examples, not a validated regimen protocol.
          Replace them with the local protocol for this patient.
        </p>
        <label className="field">
          Thresholds JSON
          <textarea
            className="input"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <label className="field">
          Local protocol source URL
          <input
            type="url"
            className="input"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
        </label>
        <label className="field">
          Clinical rationale
          <input
            className="input"
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
          />
        </label>
        <Action
          run={() =>
            request(`/v2/patients/${pid}/readiness-protocol`, "POST", {
              thresholds: JSON.parse(text),
              max_age_days: 3,
              source_url: source,
              rationale,
            })
          }
          onDone={onDone}
        >
          Sign protocol
        </Action>
      </div>
    </details>
  );
}

export function SmartInbox({ onSelect }) {
  const r = useResource("/v2/inbox", 12000),
    [drafts, setDrafts] = useState({});
  return (
    <Panel
      title="Smart inbox"
      hint="Patient messages sorted by rule-based urgency. Edit each drafted acknowledgement before sending it."
    >
      <Load resource={r}>
        {(rows) =>
          rows.length ? (
            rows.map((m) => (
              <article className="care-record" key={m.id}>
                <div className="row">
                  <button
                    className="care-link"
                    onClick={() => onSelect(m.patient_id)}
                  >
                    <b>{m.patient_name}</b>
                  </button>
                  <Status
                    value={m.data.urgency === 3 ? "emergency" : "message"}
                  />
                </div>
                <p>{m.data.text}</p>
                <label className="field">
                  Draft reply
                  <textarea
                    className="input"
                    rows={3}
                    value={drafts[m.id] ?? m.draft_reply}
                    onChange={(e) =>
                      setDrafts((v) => ({ ...v, [m.id]: e.target.value }))
                    }
                  />
                </label>
                <Action
                  run={() =>
                    request(`/v2/messages/${m.id}/reply`, "POST", {
                      text: drafts[m.id] ?? m.draft_reply,
                    })
                  }
                  onDone={r.refresh}
                >
                  Review & send reply
                </Action>
              </article>
            ))
          ) : (
            <Empty>No unanswered patient messages.</Empty>
          )
        }
      </Load>
    </Panel>
  );
}

function JourneyReplay({ events, progress, onOpen }) {
  if (!events.length) return null;
  const start = new Date(events[0].date).getTime(),
    end = new Date(events[events.length - 1].date).getTime();
  const cutoff = start + ((end - start) * progress) / 100;
  const visible = events.filter((e) => new Date(e.date).getTime() <= cutoff);
  const current = visible[visible.length - 1];
  return (
    <div className="care-notice">
      <p>
        <b>
          {new Date(cutoff).toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </b>{" "}
        · {visible.length}/{events.length} records
      </p>
      {current && (
        <button className="src" onClick={() => onOpen(current.id)}>
          D{current.id} · {current.title}
        </button>
      )}
    </div>
  );
}
