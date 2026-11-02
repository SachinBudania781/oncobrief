const el = (id) => document.getElementById(id);
let context = null;
let notes = [];
let version = 0;
const error = (message = "") => { el("error").textContent = message; el("error").hidden = !message; };

async function api(path, method = "GET", body) {
  const response = await fetch(path, { method, credentials: "same-origin", ...(body ? { body } : {}) });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(response.status === 401 ? "Sign in to OncoBrief using the link at the top, then reopen Memory Up." : detail.detail || "The request could not be completed.");
  }
  return response.json();
}

function option(value, text) {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = text;
  return node;
}

function wallTime(value) {
  return value ? value.slice(0, 16).replace("T", " at ") : "Appointment date unavailable";
}

function render() {
  const patientMode = ["patient", "caregiver"].includes(context?.user.role);
  const rows = notes.filter((row) => !el("department").value || row.department === el("department").value);
  el("history").replaceChildren();
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = patientMode ? "No doctor-reviewed Memory Up documents are available yet." : "No Memory Up documents for this patient and department yet.";
    el("history").append(empty);
  }
  for (const row of rows) {
    const card = document.createElement("article");
    card.className = "note";
    const heading = document.createElement("h3");
    heading.textContent = row.title;
    const meta = document.createElement("p");
    meta.className = "meta";
    meta.textContent = `${row.department} · ${wallTime(row.appointment_at)} · ${row.doctor || "Doctor not recorded"}`;
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = row.status === "published" ? `Reviewed by ${row.approved_by}` : "Draft · awaiting doctor review";
    const body = document.createElement("p");
    body.className = "advice";
    body.textContent = row.advice;
    card.append(heading, meta, badge, body);
    if (row.attachment_url) {
      const link = document.createElement("a");
      link.href = row.attachment_url;
      link.textContent = `Download original · ${row.attachment_name}`;
      card.append(link);
    }
    if (row.status === "draft" && context.user.role === "doctor" && context.user.department === row.department) {
      const button = document.createElement("button");
      button.textContent = "I reviewed this advice · publish for patient";
      button.addEventListener("click", async () => {
        error();
        button.disabled = true;
        try {
          await api(`/api/memory-up/${row.id}/publish`, "POST");
          el("status").textContent = "Memory Up is now available to the patient and authorized caregivers.";
          await loadPatient();
        } catch (e) { error(e.message); button.disabled = false; }
      });
      card.append(button);
    }
    el("history").append(card);
  }
}

async function loadPatient() {
  const current = ++version;
  const pid = el("patient").value;
  error();
  el("compose").hidden = true;
  el("history").replaceChildren();
  // Never retain another patient's draft text or selected attachment.
  el("memory-form").reset();
  if (!pid) return;
  try {
    const [nextContext, nextNotes] = await Promise.all([
      api(`/api/memory-up/context?patient_id=${encodeURIComponent(pid)}`),
      api(`/api/memory-up/patients/${encodeURIComponent(pid)}`),
    ]);
    if (current !== version) return;
    context = nextContext;
    notes = nextNotes;
    el("appointment").replaceChildren(option("", "Choose the appointment"), ...context.appointments.map((a) => option(a.id, `${a.department} · ${wallTime(a.start)} · ${a.clinician || ""}`)));
    el("compose").hidden = !context.can_write;
    el("save").disabled = context.appointments.length === 0;
    el("department").replaceChildren(option("", "All available departments"), ...[...new Set(notes.map((n) => n.department))].sort().map((d) => option(d, d)));
    render();
  } catch (e) { if (current === version) error(e.message); }
}

el("memory-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  error();
  const pid = el("patient").value;
  const selectedVersion = version;
  const form = new FormData(event.target);
  const file = el("file").files[0];
  if (!form.get("advice").trim() && !file) { error("Write the appointment advice or choose a document."); return; }
  if (!file) form.delete("file");
  el("save").disabled = true;
  try {
    await api(`/api/memory-up/patients/${encodeURIComponent(pid)}`, "POST", form);
    if (version !== selectedVersion) return;
    el("status").textContent = "Draft saved. The department's doctor can now review and publish it.";
    await loadPatient();
  } catch (e) { if (version === selectedVersion) error(e.message); }
  finally { el("save").disabled = !context?.appointments.length; }
});
el("patient").addEventListener("change", () => { el("status").textContent = ""; loadPatient(); });
el("department").addEventListener("change", render);
el("refresh").addEventListener("click", loadPatient);

try {
  context = await api("/api/memory-up/context");
  el("identity").textContent = `${context.user.name} · ${context.user.department || context.user.role}`;
  el("patient").replaceChildren(...context.patients.map((p) => option(p.id, `${p.name} · ${p.id}`)));
  const selectedPatient = new URLSearchParams(location.search).get("patient_id");
  if (context.patients.some((p) => p.id === selectedPatient)) el("patient").value = selectedPatient;
  el("empty-access").hidden = context.patients.length > 0;
  await loadPatient();
} catch (e) { error(e.message); el("patient").replaceChildren(option("", "Sign in to view your records")); }
