import { useState } from "react";
import { Accessibility, CalendarDays, Car, Check, MapPin, Users } from "lucide-react";
import { request, useResource, dateTime } from "./client";
import { Empty, Error, Load, Panel, Status } from "./UI";

const RIDE_TYPES = {
  standard: "Standard ride",
  wheelchair_accessible: "Wheelchair-accessible ride",
  hospital_shuttle: "Hospital shuttle",
  family_or_self: "Family or own transport",
  other: "Other",
};
const SUPPORT_LABELS = {
  mobility_assistance: "Help with walking or getting in/out",
  caregiver_accompanying: "Caregiver will travel with me",
};
const STATUS_LABELS = {
  requested: "Request sent",
  coordinating: "Care team coordinating",
  arranged: "Ride arranged",
  unable: "More help needed",
  completed: "Trip completed",
  cancelled: "Cancelled",
};

function localInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function defaultPickup(appointment) {
  const visit = new Date(appointment.start).getTime();
  const suggested = Math.max(Date.now() + 5 * 60000, visit - 60 * 60000);
  return localInput(new Date(Math.min(suggested, visit - 60000)).toISOString());
}

export default function Transport({ pid, user }) {
  const patientMode = ["patient", "caregiver"].includes(user.role);
  const appointments = useResource(patientMode ? `/appointments?upcoming=true&patient_id=${encodeURIComponent(pid)}` : null, 30000);
  const requests = useResource(patientMode ? `/v2/patients/${encodeURIComponent(pid)}/transport-requests` : "/v2/transport-requests", 20000);
  const [appointmentId, setAppointmentId] = useState("");
  const [pickupAt, setPickupAt] = useState("");
  const [pickupAddress, setPickupAddress] = useState("");
  const [landmark, setLandmark] = useState("");
  const [rideType, setRideType] = useState("standard");
  const [support, setSupport] = useState([]);
  const [companionCount, setCompanionCount] = useState(0);
  const [fareSupport, setFareSupport] = useState(false);
  const [notes, setNotes] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await request(`/v2/patients/${encodeURIComponent(pid)}/transport-requests`, "POST", {
        appointment_id: Number(appointmentId),
        pickup_at: pickupAt,
        pickup_address: pickupAddress,
        landmark,
        ride_type: rideType,
        support,
        companion_count: Number(companionCount),
        fare_support: fareSupport,
        notes,
        consent,
      });
      setSuccess("Your request is with the care team. They will update it here.");
      setAppointmentId("");
      setPickupAt("");
      setPickupAddress("");
      setLandmark("");
      setRideType("standard");
      setSupport([]);
      setCompanionCount(0);
      setFareSupport(false);
      setNotes("");
      setConsent(false);
      requests.refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack ob-transport">
      {patientMode ? (
        <Panel title="Request transport" hint="Share a pickup request for an upcoming hospital visit. Your care team will coordinate a ride and post updates here.">
          <Load resource={appointments}>
            {(items) => items.some((item) => item.status === "booked" && new Date(item.start).getTime() > Date.now()) ? (
              <form className="stack" onSubmit={submit}>
                <label className="field">
                  Hospital appointment
                  <select className="select" required value={appointmentId} onChange={(event) => {
                    const nextId = event.target.value;
                    setAppointmentId(nextId);
                    const visit = items.find((item) => String(item.id) === nextId);
                    setPickupAt(visit ? defaultPickup(visit) : "");
                  }}>
                    <option value="">Choose an upcoming appointment</option>
                    {items.filter((item) => item.status === "booked" && new Date(item.start).getTime() > Date.now()).map((item) => (
                      <option key={item.id} value={item.id}>{dateTime(item.start)} · {item.department}</option>
                    ))}
                  </select>
                </label>
                <div className="grid2">
                  <label className="field">Requested pickup time<input className="input" type="datetime-local" required value={pickupAt} onChange={(event) => setPickupAt(event.target.value)} /></label>
                  <label className="field">Ride type<select className="select" value={rideType} onChange={(event) => setRideType(event.target.value)}>{Object.entries(RIDE_TYPES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                </div>
                <label className="field">Pickup address<textarea className="input" rows={2} minLength={5} maxLength={300} required value={pickupAddress} onChange={(event) => setPickupAddress(event.target.value)} placeholder="House/building, street, area, city" /></label>
                <label className="field">Landmark (optional)<input className="input" maxLength={150} value={landmark} onChange={(event) => setLandmark(event.target.value)} placeholder="Nearby landmark or gate" /></label>
                <div className="ob-transport-options">
                  <span className="field-label"><Accessibility size={16} /> Support needed</span>
                  {Object.entries(SUPPORT_LABELS).map(([key, label]) => <label key={key} className="ob-transport-check"><input type="checkbox" checked={support.includes(key)} onChange={(event) => setSupport((old) => event.target.checked ? [...old, key] : old.filter((value) => value !== key))} />{label}</label>)}
                </div>
                <div className="grid2">
                  <label className="field">People travelling with the patient<input className="input" type="number" min="0" max="4" value={companionCount} onChange={(event) => setCompanionCount(event.target.value)} /></label>
                  <label className="ob-transport-check ob-fare-check"><input type="checkbox" checked={fareSupport} onChange={(event) => setFareSupport(event.target.checked)} />I would like help exploring travel-cost support</label>
                </div>
                <label className="field">Anything else the coordinator should know? (optional)<textarea className="input" rows={2} maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Keep this to transport needs; do not enter urgent medical symptoms here." /></label>
                <label className="ob-transport-check ob-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} required />I agree to share these pickup and support details with my assigned care team for coordination.</label>
                <p className="small muted">This sends a request to your care team; it does not book a vehicle or guarantee a ride. For urgent or emergency transport, contact local emergency services.</p>
                <div className="row wrap"><button className="btn primary" type="submit" disabled={busy || !consent}><Car size={16} />{busy ? "Sending…" : "Send transport request"}</button>{success && <span className="care-success">{success}</span>}</div>
                <Error message={error} />
              </form>
            ) : <Empty>No upcoming booked visits found. Book a visit in Hospital day pass first.</Empty>}
          </Load>
        </Panel>
      ) : (
        <Panel title="Transport coordination queue" hint="Requests are scoped to patients assigned to your account. Update the coordination status and confirmed ride details.">
          <Load resource={requests}>
            {(items) => items.length ? <div className="ob-transport-list">{items.map((item) => <CoordinatorCard key={item.id} item={item} onUpdate={requests.refresh} />)}</div> : <Empty>No transport requests for your assigned patients.</Empty>}
          </Load>
        </Panel>
      )}
      {patientMode && (
        <Panel title="My transport requests" hint="Review the request and any update from your care team.">
          <Load resource={requests}>
            {(items) => items.length ? <div className="ob-transport-list">{items.map((item) => <PatientRequestCard key={item.id} item={item} onUpdate={requests.refresh} />)}</div> : <Empty>No transport requests yet.</Empty>}
          </Load>
        </Panel>
      )}
    </div>
  );
}

function PatientRequestCard({ item, onUpdate }) {
  const [error, setError] = useState("");
  const data = item.data || {};
  const appointment = item.appointment;
  return (
    <article className="ob-transport-card">
      <div className="row wrap ob-transport-title"><div><b><CalendarDays size={16} />{appointment ? `${dateTime(appointment.start)} · ${appointment.department}` : "Appointment details unavailable"}</b><small>Pickup requested for {dateTime(data.pickup_at)}</small></div><Status value={item.status} /></div>
      <div className="ob-transport-details"><span><MapPin size={15} />{data.pickup_address}{data.landmark ? ` · ${data.landmark}` : ""}</span><span><Car size={15} />{RIDE_TYPES[data.ride_type] || "Other ride"}</span>{data.support?.length > 0 && <span><Accessibility size={15} />{data.support.map((key) => SUPPORT_LABELS[key]).join("; ")}</span>}<span><Users size={15} />{data.companion_count || 0} additional travellers</span>{data.fare_support && <span>Travel-cost help requested</span>}</div>
      {data.arranged_via && <p><b>Arranged via:</b> {data.arranged_via}{data.confirmed_pickup_at ? ` · Pickup ${dateTime(data.confirmed_pickup_at)}` : ""}</p>}
      {data.coordination_note && <p className="ob-transport-note"><b>Care-team update:</b> {data.coordination_note}</p>}
      {data.notes && <p><b>Your note:</b> {data.notes}</p>}
      {!['completed', 'cancelled'].includes(item.status) && <><button className="btn" type="button" onClick={async () => { setError(""); try { await request(`/v2/transport-requests/${item.id}/cancel`, "POST"); onUpdate(); } catch (e) { setError(e.message); } }}>Cancel request</button><Error message={error} /></>}
    </article>
  );
}

function CoordinatorCard({ item, onUpdate }) {
  const data = item.data || {};
  const appointment = item.appointment;
  const [status, setStatus] = useState(item.status === "requested" ? "coordinating" : item.status);
  const [arrangedVia, setArrangedVia] = useState(data.arranged_via || "");
  const [pickupAt, setPickupAt] = useState(localInput(data.confirmed_pickup_at));
  const [note, setNote] = useState(data.coordination_note || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const closed = ["completed", "cancelled"].includes(item.status);
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await request(`/v2/transport-requests/${item.id}`, "PATCH", {
        status,
        arranged_via: arrangedVia,
        confirmed_pickup_at: pickupAt || null,
        coordination_note: note,
      });
      setSuccess("Update saved.");
      onUpdate();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="ob-transport-card">
      <div className="row wrap ob-transport-title"><div><b>{item.patient_name || item.patient_id} · {appointment ? `${appointment.department} · ${dateTime(appointment.start)}` : "Appointment unavailable"}</b><small>{item.patient_id} · Requested by {item.author_name}</small></div><Status value={item.status} /></div>
      <div className="ob-transport-details"><span><MapPin size={15} />{data.pickup_address}{data.landmark ? ` · ${data.landmark}` : ""}</span><span><Car size={15} />{RIDE_TYPES[data.ride_type] || "Other ride"}</span><span><CalendarDays size={15} />Preferred pickup {dateTime(data.pickup_at)}</span>{data.support?.length > 0 && <span><Accessibility size={15} />{data.support.map((key) => SUPPORT_LABELS[key]).join("; ")}</span>}<span><Users size={15} />{data.companion_count || 0} additional travellers</span>{data.fare_support && <span>Travel-cost support requested</span>}</div>
      {data.notes && <p><b>Patient note:</b> {data.notes}</p>}
      {!closed && <form className="stack ob-transport-update" onSubmit={save}>
        <div className="grid2">
          <label className="field">Coordination status<select className="select" value={status} onChange={(event) => setStatus(event.target.value)}>{["coordinating", "arranged", "unable", ...(item.status === "arranged" ? ["completed"] : [])].map((value) => <option key={value} value={value}>{STATUS_LABELS[value]}</option>)}</select></label>
          <label className="field">Arranged via<input className="input" maxLength={120} value={arrangedVia} onChange={(event) => setArrangedVia(event.target.value)} placeholder="Hospital shuttle, local provider, family…" /></label>
          <label className="field">Confirmed pickup time<input className="input" type="datetime-local" value={pickupAt} onChange={(event) => setPickupAt(event.target.value)} /></label>
          <label className="field">Update for the patient<input className="input" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Coordinator message" /></label>
        </div>
        <div className="row wrap"><button className="btn primary" disabled={busy}><Check size={16} />{busy ? "Saving…" : "Save coordination update"}</button>{success && <span className="care-success">{success}</span>}</div>
        <Error message={error} />
      </form>}
    </article>
  );
}
