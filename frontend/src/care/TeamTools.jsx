import { useEffect, useState } from "react";
import { request, useResource, dateTime, nice } from "./client";
import {
  Action,
  Empty,
  Error,
  Load,
  Panel,
  RecordCard,
  RecordForm,
  Status,
  Voice,
} from "./UI";
import { BodyMap } from "./ClinicalTools";

export function Journal({
  pid,
  user,
  onOpen,
  initialKind,
  focusedRecordId,
  onClearFocus,
}) {
  const specs = useResource("/v2/workflows"),
    history = useResource(`/v2/patients/${pid}/records`, 15000);
  const [kind, setKind] = useState(initialKind || ""),
    [filter, setFilter] = useState("");
  useEffect(() => {
    if (initialKind) setKind(initialKind);
  }, [initialKind]);
  const scopes = user.permissions?.[pid] || [];
  const available = Object.fromEntries(
    Object.entries(specs.data || {}).filter(
      ([, s]) => scopes.includes("all") || scopes.includes(s.scope),
    ),
  );
  return (
    <div className="care-columns">
      <Panel
        title="Plans, notes & daily life"
        hint="Choose a workflow. Each record keeps its author, source and review status."
      >
        <select
          className="select"
          aria-label="Choose workflow"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="">Choose what to record…</option>
          {Object.entries(available).map(([k, s]) => (
            <option value={k} key={k}>
              {s.title}
            </option>
          ))}
        </select>
        {kind && available[kind] && (
          <div className="stack" style={{ marginTop: 20 }}>
            <h3>{available[kind].title}</h3>
            {kind === "pain" && (
              <BodyMap
                onSite={(site) => {
                  window.dispatchEvent(
                    new CustomEvent("body-site", { detail: site }),
                  );
                }}
                measurements={(history.data || []).filter(
                  (r) => r.kind === "pain",
                )}
              />
            )}
            {kind === "buddy" && <BuddyMatches pid={pid} />}
            {kind === "nurse_handover" ? (
              <Handover pid={pid} onDone={history.refresh} />
            ) : kind === "scribe" ? (
              <ConsultationStudio pid={pid} onSaved={history.refresh} />
            ) : (
              <RecordForm
                kind={kind}
                spec={available[kind]}
                pid={pid}
                onSaved={history.refresh}
              />
            )}
          </div>
        )}
        <Error message={specs.error} />
      </Panel>
      <Panel title="Shared folder journal">
        {focusedRecordId && (
          <p className="care-notice">
            Showing cited record R{focusedRecordId}.{" "}
            <button className="btn" onClick={onClearFocus}>
              Show all records
            </button>
          </p>
        )}
        <select
          className="select"
          aria-label="Filter journal"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="">All records</option>
          {[...new Set((history.data || []).map((r) => r.kind))].map((k) => (
            <option value={k} key={k}>
              {nice(k)}
            </option>
          ))}
        </select>
        <Load resource={history}>
          {(items) =>
            items.filter(
              (r) =>
                (!filter || r.kind === filter) &&
                (!focusedRecordId || r.id === focusedRecordId),
            ).length ? (
              items
                .filter(
                  (r) =>
                    (!filter || r.kind === filter) &&
                    (!focusedRecordId || r.id === focusedRecordId),
                )
                .map((r) => (
                  <RecordCard
                    key={r.id}
                    record={r}
                    user={user}
                    onChange={history.refresh}
                    onOpen={onOpen}
                  />
                ))
            ) : (
              <Empty>
                Record something using the form. Signed notes and care plans
                will appear here.
              </Empty>
            )
          }
        </Load>
      </Panel>
    </div>
  );
}

export function CareChat({ pid }) {
  const resource = useResource(`/v2/patients/${pid}/chat`, 8000);
  const [text, setText] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [instruction, setInstruction] = useState("");
  useEffect(() => {
    setText("");
    setInstruction("");
  }, [pid]);
  return (
    <div className="care-columns">
      <Panel
        title="Your care circle chat"
        hint="Patient, invited family and assigned care team share this conversation."
      >
        <Load resource={resource}>
          {(d) => (
            <div className="care-chat-log">
              {d.messages.length ? (
                d.messages.map((m) => (
                  <article className="care-message" key={m.id}>
                    <div className="row">
                      <b>{m.author_name}</b>
                      <Status value={m.author_role} />
                      <span className="spacer" />
                      <small className="muted">{dateTime(m.created_at)}</small>
                    </div>
                    <p className="care-pre">{m.data.text}</p>
                    {m.data.urgency >= 2 && (
                      <span className="care-status status-emergency">
                        Flagged for triage
                      </span>
                    )}
                  </article>
                ))
              ) : (
                <Empty>Start a conversation with your care team.</Empty>
              )}
            </div>
          )}
        </Load>
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const r = await request(`/v2/patients/${pid}/chat`, "POST", {
                text,
              });
              setText("");
              setInstruction(r.instruction || "");
              resource.refresh();
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            Message
            <textarea
              className="input"
              rows={3}
              required
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <Voice onText={(v) => setText((t) => `${t} ${v}`)} />
          <button className="btn primary" disabled={busy}>
            Send to care circle
          </button>
          <Error message={error} />
          {instruction && (
            <p className="care-emergency" role="alert">
              {instruction}
            </p>
          )}
        </form>
      </Panel>
      <Panel
        title="Three-line thread recap"
        hint="Extractive recap of the most recent messages; review the conversation before acting."
      >
        {resource.data?.summary.map((s, i) => (
          <p key={i}>{s}</p>
        ))}
        <p className="small muted">
          Urgent language is checked by fixed rules. A chat message does not
          guarantee immediate staff attendance.
        </p>
      </Panel>
    </div>
  );
}

export function CareCircle({ pid }) {
  const resource = useResource(`/v2/patients/${pid}/circle`);
  const [v, setV] = useState({
      username: "",
      name: "",
      password: "",
      scopes: ["appointments"],
      consent: false,
    }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const scopes = [
    "medicines",
    "appointments",
    "checkin",
    "alerts",
    "chat",
    "notes",
    "documents",
    "nutrition",
    "finance",
    "activity",
  ];
  return (
    <div className="care-columns">
      <Panel
        title="Invite someone you trust"
        hint="Choose exactly what they can see. You can withdraw their access at any time."
      >
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            setBusy(true);
            try {
              await request(`/v2/patients/${pid}/circle`, "POST", v);
              setV({
                username: "",
                name: "",
                password: "",
                scopes: ["appointments"],
                consent: false,
              });
              resource.refresh();
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {[
            ["name", "Their name"],
            ["username", "New caregiver username"],
            ["password", "Initial password (12+ characters)"],
          ].map(([key, label]) => (
            <label className="field" key={key}>
              {label}
              <input
                className="input"
                type={key === "password" ? "password" : "text"}
                required
                minLength={key === "password" ? 12 : 2}
                value={v[key]}
                onChange={(e) => setV({ ...v, [key]: e.target.value })}
              />
            </label>
          ))}
          <div className="care-scopes">
            {scopes.map((s) => (
              <label className="care-check" key={s}>
                <input
                  type="checkbox"
                  checked={v.scopes.includes(s)}
                  onChange={(e) =>
                    setV({
                      ...v,
                      scopes: e.target.checked
                        ? [...v.scopes, s]
                        : v.scopes.filter((x) => x !== s),
                    })
                  }
                />
                {nice(s)}
              </label>
            ))}
          </div>
          <label className="care-check">
            <input
              type="checkbox"
              required
              checked={v.consent}
              onChange={(e) => setV({ ...v, consent: e.target.checked })}
            />
            I consent to this person accessing the selected information.
          </label>
          <Error message={error} />
          <button className="btn primary" disabled={busy}>
            Create caregiver invitation
          </button>
        </form>
      </Panel>
      <Panel title="People with access">
        <Load resource={resource}>
          {(items) =>
            items.map((g) => (
              <article className="care-record" key={g.id}>
                <div className="row wrap">
                  <b>{g.name}</b>
                  <Status value={g.role} />
                  <Status value={g.active ? "active" : "revoked"} />
                </div>
                <p className="small">
                  {g.scopes.join(", ")} · {g.consent_by}
                </p>
                {g.role === "caregiver" && g.active && (
                  <Action
                    run={() => request(`/v2/circle/${g.id}`, "DELETE")}
                    onDone={resource.refresh}
                  >
                    Withdraw access
                  </Action>
                )}
              </article>
            ))
          }
        </Load>
      </Panel>
    </div>
  );
}

export function VisitPrep({ pid }) {
  const resource = useResource(`/v2/patients/${pid}/visit-prep`);
  return (
    <Panel
      title="Before your visit"
      hint="A question list drawn from your priorities and recent reports."
    >
      <Load resource={resource}>
        {(d) => (
          <>
            <ol className="care-question-list">
              {d.questions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ol>
            <p>{d.pending_requests} requests awaiting a doctor.</p>
            <button className="btn" onClick={() => window.print()}>
              Print my questions
            </button>
          </>
        )}
      </Load>
    </Panel>
  );
}

export function Privacy({ pid, user }) {
  const audit = useResource(
      pid && ["patient", "doctor", "nurse", "admin"].includes(user.role)
        ? `/v2/patients/${pid}/audit`
        : null,
    ),
    devices = useResource("/auth/devices");
  const [verification, setVerification] = useState(null),
    [reason, setReason] = useState(""),
    [target, setTarget] = useState("");
  return (
    <div className="stack">
      {["privacy", "admin"].includes(user.role) && <PrivacyRequests />}
      <div className="care-columns">
        <Panel
          title="Who opened my records"
          action={
            <Action
              run={() => request("/v2/audit/verify")}
              onDone={setVerification}
            >
              Verify audit chain
            </Action>
          }
        >
          {verification && (
            <p className={verification.valid ? "care-success" : "care-error"}>
              {verification.valid
                ? "Audit hash chain is intact."
                : `Tampering detected at entry ${verification.first_invalid_id}.`}
            </p>
          )}
          <Load resource={audit}>
            {(rows) => (
              <div className="care-scroll">
                <table className="list">
                  <thead>
                    <tr>
                      <th>Who</th>
                      <th>What</th>
                      <th>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td>
                          {r.actor_name}
                          <br />
                          <small>{r.actor_role}</small>
                        </td>
                        <td>
                          {r.action}
                          <br />
                          <small className="muted">{r.detail}</small>
                        </td>
                        <td className="small">{dateTime(r.at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Load>
          <p className="small muted">
            Hash chaining detects edits within the chain. An independently
            stored head hash is needed to detect complete chain replacement.
          </p>
        </Panel>
        <Panel title="Signed-in devices">
          <Load resource={devices}>
            {(rows) =>
              rows.map((d) => (
                <article className="care-record" key={d.id}>
                  <b>{d.current ? "This device" : "Other device"}</b>
                  <p className="small care-device">{d.device}</p>
                  <p className="small">Last activity {dateTime(d.last_seen)}</p>
                  <Action
                    run={() => request(`/auth/devices/${d.id}`, "DELETE")}
                    onDone={() => {
                      if (d.current)
                        window.dispatchEvent(new Event("ob-session-expired"));
                      else devices.refresh();
                    }}
                  >
                    Sign out this device
                  </Action>
                </article>
              ))
            }
          </Load>
        </Panel>
      </div>
      {["doctor", "nurse"].includes(user.role) && (
        <Panel
          title="Emergency access outside my care list"
          hint="Requires a typed clinical reason. Temporary access lasts 15 minutes, appears in the patient log and alerts the privacy officer."
        >
          <div className="grid2">
            <label className="field">
              Patient ID
              <input
                className="input"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
            </label>
            <label className="field">
              Emergency reason (15+ characters)
              <input
                className="input"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          </div>
          <Action
            run={() =>
              request("/v2/break-glass", "POST", { patient_id: target, reason })
            }
            onDone={() => window.location.reload()}
          >
            Open with recorded reason
          </Action>
        </Panel>
      )}
    </div>
  );
}

export function Integrations({ pid, user, language }) {
  const resource = useResource("/v2/integrations");
  const [documentId, setDocumentId] = useState("");
  const [service, setService] = useState("translation"),
    [text, setText] = useState(""),
    [consent, setConsent] = useState(false),
    [result, setResult] = useState(null);
  return (
    <div className="stack">
      <Panel
        title="Connected services & setup"
        hint="Missing credentials are explicit placeholders. Browser voice and manual entry work independently."
      >
        <Load resource={resource}>
          {(d) => (
            <>
              <div className="care-integration-grid">
                {d.services.map((s) => (
                  <article className="care-record" key={s.service}>
                    <div className="row">
                      <b>{nice(s.service)}</b>
                      <Status
                        value={s.configured ? "configured" : "needs_setup"}
                      />
                    </div>
                    <p className="small muted">{s.settings.join(" + ")}</p>
                  </article>
                ))}
              </div>
              <p className="care-notice">
                Hospital emergency contact: {d.hospital_emergency}
                <br />
                Hospital address: {d.hospital_address}
                <br />
                India hosting confirmed:{" "}
                {d.india_hosting_confirmed
                  ? "yes"
                  : "requires deployment setup"}
              </p>
            </>
          )}
        </Load>
      </Panel>
      <Panel
        title="Use a configured service"
        hint="External results are drafts and require human review. A service without its URL and key returns a clear setup error."
      >
        <div className="stack">
          <label className="field">
            Service
            <select
              className="select"
              value={service}
              onChange={(e) => setService(e.target.value)}
            >
              {[
                "translation",
                "speech",
                "telemedicine",
                "wearables",
                "weather",
                "vision",
                ...(["doctor"].includes(user.role)
                  ? ["trials", "prices", "formulary", "evidence"]
                  : []),
                ...(["doctor", "nurse", "navigator", "admin"].includes(
                  user.role,
                )
                  ? [
                      "phone",
                      "sms",
                      "whatsapp",
                      ...(["doctor", "nurse"].includes(user.role)
                        ? ["er"]
                        : []),
                    ]
                  : []),
              ].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Text / query
            <textarea
              className="input"
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <Voice
            language={language}
            onText={(v) => setText((t) => `${t} ${v}`)}
          />
          <label className="field">
            Optional source image / audio document ID
            <input
              className="input"
              type="number"
              min="1"
              value={documentId}
              onChange={(e) => setDocumentId(e.target.value)}
            />
          </label>
          <label className="care-check">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            I consent to sending this information to the configured provider.
          </label>
          <Action
            run={() =>
              request(`/v2/patients/${pid}/integration`, "POST", {
                service,
                consent,
                payload: {
                  text,
                  ...(documentId ? { document_id: Number(documentId) } : {}),
                  source_language: "en",
                  target_language: language,
                },
              })
            }
            onDone={setResult}
          >
            Use service
          </Action>
          {result && (
            <pre className="care-pre">{JSON.stringify(result, null, 2)}</pre>
          )}
        </div>
      </Panel>
      {["doctor", "dietitian"].includes(user.role) && <LibraryReview />}
      {user.role === "admin" && (
        <>
          <AdminUserForm />
          <RelationshipForm />
        </>
      )}
    </div>
  );
}

function AdminUserForm() {
  const [v, setV] = useState({
      username: "",
      name: "",
      role: "doctor",
      password: "",
      phone: "",
      department: "",
      ward: "",
      patient_ids: "",
    }),
    [result, setResult] = useState(null);
  return (
    <Panel
      title="Create a hospital account"
      hint="Staff must use their own account and authenticator in production. Assign only patients in their care."
    >
      <div className="stack">
        {[
          "username",
          "name",
          "password",
          "phone",
          "department",
          "ward",
          "patient_ids",
        ].map((key) => (
          <label key={key} className="field">
            {key === "patient_ids"
              ? "Assigned patient IDs, comma-separated"
              : nice(key)}
            <input
              className="input"
              type={key === "password" ? "password" : "text"}
              value={v[key]}
              onChange={(e) => setV({ ...v, [key]: e.target.value })}
            />
          </label>
        ))}
        <label className="field">
          Role
          <select
            className="select"
            value={v.role}
            onChange={(e) => setV({ ...v, role: e.target.value })}
          >
            {[
              "doctor",
              "nurse",
              "lab",
              "frontdesk",
              "navigator",
              "dietitian",
              "privacy",
              "patient",
            ].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <Action
          run={() =>
            request("/auth/users", "POST", {
              ...v,
              patient_ids: v.patient_ids
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean),
            })
          }
          onDone={setResult}
        >
          Create account
        </Action>
        {result && (
          <div className="care-notice">
            <p>{result.message}</p>
            <code className="care-device">{result.totp_setup_uri}</code>
          </div>
        )}
      </div>
    </Panel>
  );
}

function ConsultationStudio({ pid, onSaved }) {
  const [consent, setConsent] = useState(false),
    [speaker, setSpeaker] = useState("doctor"),
    [language, setLanguage] = useState("mr"),
    [text, setText] = useState(""),
    [caption, setCaption] = useState(""),
    [assessment, setAssessment] = useState(""),
    [plan, setPlan] = useState(""),
    [saved, setSaved] = useState(false);
  return (
    <div className="stack">
      <label className="care-check">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        The patient consents to recording, translation and saving this
        consultation transcript.
      </label>
      <div className="grid2">
        <label className="field">
          Speaker
          <select
            className="select"
            value={speaker}
            onChange={(e) => setSpeaker(e.target.value)}
          >
            <option value="doctor">Doctor (English)</option>
            <option value="patient">Patient</option>
          </select>
        </label>
        <label className="field">
          Patient language
          <select
            className="select"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          >
            <option value="hi">हिंदी</option>
            <option value="mr">मराठी</option>
            <option value="en">English</option>
          </select>
        </label>
      </div>
      {consent ? (
        <Voice
          language={speaker === "doctor" ? "en" : language}
          onText={(v) => {
            setCaption(v);
            setText((t) => `${t}\n${speaker}: ${v}`.trim());
          }}
        />
      ) : (
        <p className="small muted">Enable consent before recording.</p>
      )}
      <label className="field">
        Current caption
        <input
          className="input"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
        />
      </label>
      <Action
        run={() =>
          request(`/v2/patients/${pid}/integration`, "POST", {
            service: "translation",
            consent,
            payload: {
              text: caption,
              source_language: speaker === "doctor" ? "en" : language,
              target_language: speaker === "doctor" ? language : "en",
            },
          })
        }
        onDone={(r) => {
          const translated = r.result.text || r.result.translation;
          setText(
            (t) =>
              `${t}\nTranslation draft: ${translated || JSON.stringify(r.result)}`,
          );
        }}
      >
        Translate caption with configured interpreter
      </Action>
      <label className="field">
        Transcript and editable translation captions
        <textarea
          className="input"
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <label className="field">
        Structured note: assessment
        <textarea
          className="input"
          rows={3}
          value={assessment}
          onChange={(e) => setAssessment(e.target.value)}
        />
      </label>
      <label className="field">
        Structured note: plan and patient takeaways
        <textarea
          className="input"
          rows={3}
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
        />
      </label>
      <Action
        className="btn primary"
        run={() =>
          request(`/v2/patients/${pid}/records`, "POST", {
            kind: "scribe",
            data: { consent, text, assessment, plan, language },
          })
        }
        onDone={() => {
          setSaved(true);
          onSaved();
        }}
      >
        Save consultation draft for signature
      </Action>
      {saved && (
        <p className="care-success">
          Draft saved. Review and sign it in the shared folder journal.
        </p>
      )}
    </div>
  );
}

function LibraryReview() {
  const r = useResource("/v2/library");
  return (
    <Panel
      title="Doctor / dietitian library review"
      hint="Review sources and every language before approving guidance. Production items start unpublished."
    >
      <Load resource={r}>
        {(items) =>
          items.map((x) => (
            <article className="care-record" key={x.id}>
              <h3>{x.title}</h3>
              <a href={x.source_url} target="_blank" rel="noreferrer">
                Source
              </a>
              <pre className="care-pre">
                {JSON.stringify(x.content, null, 2)}
              </pre>
              <p>
                {x.approved_by
                  ? `Approved by ${x.approved_by}`
                  : "Awaiting clinical review"}
              </p>
              <Action
                run={() => request(`/v2/library/${x.id}/approve`, "POST")}
                onDone={r.refresh}
              >
                Approve this content library item
              </Action>
            </article>
          ))
        }
      </Load>
    </Panel>
  );
}

function RelationshipForm() {
  const users = useResource("/auth/users"),
    [uid, setUid] = useState(""),
    [pid, setPid] = useState(""),
    [reason, setReason] = useState(""),
    [done, setDone] = useState(false);
  return (
    <Panel
      title="Assign a patient relationship"
      hint="Doctors receive only assigned folders. Nurses are assigned to their ward's patients. Caregivers require a patient invitation instead."
    >
      <div className="stack">
        <label className="field">
          Hospital / patient account
          <select
            className="select"
            value={uid}
            onChange={(e) => setUid(e.target.value)}
          >
            <option value="">Choose account</option>
            {users.data
              ?.filter(
                (u) => !["caregiver", "privacy", "admin"].includes(u.role),
              )
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {u.role} · {u.ward}
                </option>
              ))}
          </select>
        </label>
        <Action
          run={() =>
            request(`/v2/patients/${pid}/scribe-draft`, "POST", {
              text,
              language,
              consent,
            })
          }
          onDone={(d) => {
            setAssessment(d.assessment);
            setPlan(`${d.plan}\n\nPatient takeaways (draft): ${d.takeaways}`);
          }}
        >
          Draft structured note and patient takeaways
        </Action>
        <label className="field">
          Patient ID
          <input
            className="input"
            value={pid}
            onChange={(e) => setPid(e.target.value)}
          />
        </label>
        <label className="field">
          Assignment reason
          <input
            className="input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <Action
          run={() =>
            request("/auth/relationships", "POST", {
              user_id: Number(uid),
              patient_id: pid,
              reason,
            })
          }
          onDone={() => setDone(true)}
        >
          Assign care access
        </Action>
        {done && (
          <p className="care-success">
            Relationship saved. The account will see it after signing in again.
          </p>
        )}
      </div>
    </Panel>
  );
}

function BuddyMatches({ pid }) {
  const r = useResource(`/v2/patients/${pid}/buddy-matches`);
  return (
    <Load resource={r}>
      {(d) => (
        <div className="care-notice">
          <p>{d.message}</p>
          {d.matches.map((m) => (
            <p key={m.volunteer_id}>
              {m.display_name} · {m.cancer_type} · {m.language}
            </p>
          ))}
        </div>
      )}
    </Load>
  );
}

function Handover({ pid, onDone }) {
  const r = useResource("/v2/handover", 15000),
    [saved, setSaved] = useState(false);
  return (
    <Load resource={r}>
      {(d) => (
        <div className="stack">
          <pre className="care-pre">{d.text}</pre>
          <button className="btn" onClick={() => window.print()}>
            Print shift handover
          </button>
          <Action
            className="btn primary"
            run={() =>
              request(`/v2/patients/${pid}/records`, "POST", {
                kind: "nurse_handover",
                data: { text: d.text, acknowledged: true },
              })
            }
            onDone={() => {
              setSaved(true);
              onDone();
            }}
          >
            Incoming nurse: acknowledge this handover
          </Action>
          {saved && (
            <p className="care-success">
              Handover acknowledged with your name and time.
            </p>
          )}
        </div>
      )}
    </Load>
  );
}

function PrivacyRequests() {
  const r = useResource("/v2/privacy-requests", 15000),
    [responses, setResponses] = useState({});
  return (
    <Panel
      title="Privacy rights requests"
      hint="Review identity and applicable retention obligations before completing a request. This workflow records a response; it does not silently erase clinical records."
    >
      <Load resource={r}>
        {(rows) =>
          rows.length ? (
            rows.map((x) => (
              <article className="care-record" key={x.id}>
                <div className="row">
                  <b>
                    {x.patient_id} · {x.data.request_type}
                  </b>
                  <Status value={x.status} />
                </div>
                <p>{x.data.text}</p>
                {x.data.officer_response && <p>{x.data.officer_response}</p>}
                {x.status !== "completed" && (
                  <>
                    <label className="field">
                      Privacy officer response
                      <textarea
                        className="input"
                        value={responses[x.id] || ""}
                        onChange={(e) =>
                          setResponses((v) => ({
                            ...v,
                            [x.id]: e.target.value,
                          }))
                        }
                      />
                    </label>
                    <Action
                      run={() =>
                        request(`/v2/records/${x.id}/action`, "POST", {
                          action: "complete",
                          text: responses[x.id] || "",
                        })
                      }
                      onDone={r.refresh}
                    >
                      Record response and complete review
                    </Action>
                  </>
                )}
              </article>
            ))
          ) : (
            <Empty>No rights requests.</Empty>
          )
        }
      </Load>
    </Panel>
  );
}
