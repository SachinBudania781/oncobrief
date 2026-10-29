import { useEffect, useState } from "react";
import { Accessibility, CalendarDays, Car, Check, ExternalLink, MapPin, Users } from "lucide-react";
import { request, useResource, dateTime } from "./client";
import { Empty, Error, Load, Panel, Status } from "./UI";

const RIDE_TYPES = {
  uber: "Uber",
  rapido: "Rapido",
  hospital: "Ask the hospital to arrange",
  caregiver: "Ask my caregiver to arrange",
};
const SUPPORT_LABELS = {
  mobility_assistance: "Help with walking or getting in/out",
  wheelchair_accessible: "Wheelchair-accessible vehicle",
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

export default function Transport({ pid, user, active = true }) {
  const patientMode = ["patient", "caregiver"].includes(user.role);
  const appointments = useResource(patientMode ? `/appointments?upcoming=true&patient_id=${encodeURIComponent(pid)}` : null, 30000);
  const requests = useResource(patientMode ? `/v2/patients/${encodeURIComponent(pid)}/transport-requests` : "/v2/transport-requests", 20000);
  const [appointmentId, setAppointmentId] = useState("");
  const [pickupAt, setPickupAt] = useState("");
  const [pickupAddress, setPickupAddress] = useState("");
  const [landmark, setLandmark] = useState("");
  const [rideType, setRideType] = useState("uber");
  const [support, setSupport] = useState([]);
  const [companionCount, setCompanionCount] = useState(0);
  const [fareSupport, setFareSupport] = useState(false);
  const [notes, setNotes] = useState("");
  const [consent, setConsent] = useState(false);
  const [locationConsent, setLocationConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const saved = await request(`/v2/patients/${encodeURIComponent(pid)}/transport-requests`, "POST", {
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
        location_consent: locationConsent,
      });
      const accepted = saved.delivery_summary?.external_accepted || 0;
      const pending = saved.delivery_summary?.external_pending || 0;
      const failed = saved.delivery_summary?.external_failed || 0;
      setSuccess(accepted && pending
        ? `Request saved. The messaging service accepted SMS/email for ${accepted} contact${accepted === 1 ? "" : "s"}; another contact still needs verified details or setup. Delivery is not confirmed.`
        : accepted
          ? `Request saved. The messaging service accepted SMS/email for ${accepted} contact${accepted === 1 ? "" : "s"}. Delivery is not confirmed.`
          : pending
            ? "Request saved and shown in-app. SMS/email needs a configured messaging service and verified contact."
            : failed
              ? "Request saved and shown in-app, but an external message failed."
              : "Request saved. Your assigned care team has been notified in-app.");
      setAppointmentId("");
      setPickupAt("");
      setPickupAddress("");
      setLandmark("");
      setRideType("uber");
      setSupport([]);
      setCompanionCount(0);
      setFareSupport(false);
      setNotes("");
      setConsent(false);
      setLocationConsent(false);
      requests.refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`stack ob-transport ${active ? "" : "ob-transport-hidden"}`}>
      {patientMode ? (
        <Panel title="Plan transport" hint="Choose one of four ways to get to an upcoming hospital visit. Uber and Rapido open their booking service; hospital or caregiver requests are sent for coordination.">
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
                  <label className="field">How should the ride be arranged?<select className="select" value={rideType} onChange={(event) => setRideType(event.target.value)}>{Object.entries(RIDE_TYPES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                </div>
                {rideType === "uber" && <a className="btn ob-transport-app-link" href="https://m.uber.com/ul/" target="_blank" rel="noopener noreferrer">Open Uber <ExternalLink size={15} /></a>}
                {rideType === "rapido" && <a className="btn ob-transport-app-link" href="https://www.rapido.bike/" target="_blank" rel="noopener noreferrer">Open Rapido <ExternalLink size={15} /></a>}
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
                <label className="ob-transport-check ob-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} required />I agree to share these pickup and support details with the hospital transport team and/or my linked caregiver, based on the option I selected.</label>
                <label className="ob-transport-check ob-consent"><input type="checkbox" checked={locationConsent} onChange={(event) => setLocationConsent(event.target.checked)} />Share my live trip location with the hospital transport team and linked caregiver(s). Location starts only when I press Start trip and can be stopped at any time.</label>
                {locationConsent && <p className="small muted">A private link goes to these contacts. The last received location stays visible until you stop sharing or the link expires. Keep this page open; if updates pause, recipients will see a stale-location warning.</p>}
                <p className="small muted">Uber and Rapido booking happens in their service. OncoBrief does not book or pay for rides. For urgent or emergency transport, contact local emergency services.</p>
                <div className="row wrap"><button className="btn primary" type="submit" disabled={busy || !consent}><Car size={16} />{busy ? "Sending…" : "Save transport plan"}</button>{success && <span className="care-success">{success}</span>}</div>
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
  const [trackingError, setTrackingError] = useState("");
  const [trackingBusy, setTrackingBusy] = useState(false);
  const [watchId, setWatchId] = useState(null);
  const data = item.data || {};
  const appointment = item.appointment;
  const startSharing = async () => {
    setTrackingError("");
    setTrackingBusy(true);
    try {
      if (!navigator.geolocation) throw new Error("Location sharing is not supported in this browser.");
      const first = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true, maximumAge: 10000, timeout: 20000,
      }));
      await request(`/v2/transport-requests/${item.id}/location/start`, "POST");
      await request(`/v2/transport-requests/${item.id}/location`, "POST", {
        latitude: first.coords.latitude,
        longitude: first.coords.longitude,
        accuracy_m: first.coords.accuracy,
      });
      let lastSent = Date.now();
      const id = navigator.geolocation.watchPosition((position) => {
        if (Date.now() - lastSent < 20000) return;
        lastSent = Date.now();
        request(`/v2/transport-requests/${item.id}/location`, "POST", {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy_m: position.coords.accuracy,
        }).catch((e) => setTrackingError(e.message));
      }, (geoError) => setTrackingError(geoError.message || "Location updates paused. Check your browser permission."), {
        enableHighAccuracy: true, maximumAge: 10000, timeout: 20000,
      });
      setWatchId(id);
      onUpdate();
    } catch (e) {
      setTrackingError(e.code ? "Location permission was denied or unavailable. Allow location access and try again." : e.message);
    } finally {
      setTrackingBusy(false);
    }
  };
  const stopSharing = async () => {
    setTrackingError("");
    setTrackingBusy(true);
    try {
      if (watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
      setWatchId(null);
      await request(`/v2/transport-requests/${item.id}/location/stop`, "POST");
      onUpdate();
    } catch (e) {
      setTrackingError(e.message);
    } finally {
      setTrackingBusy(false);
    }
  };
  useEffect(() => () => {
    if (watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
  }, [watchId]);
  return (
    <article className="ob-transport-card">
      <div className="row wrap ob-transport-title"><div><b><CalendarDays size={16} />{appointment ? `${dateTime(appointment.start)} · ${appointment.department}` : "Appointment details unavailable"}</b><small>Pickup requested for {dateTime(data.pickup_at)}</small></div><Status value={item.status} /></div>
      <div className="ob-transport-details"><span><MapPin size={15} />{data.pickup_address}{data.landmark ? ` · ${data.landmark}` : ""}</span><span><Car size={15} />{RIDE_TYPES[data.ride_type] || "Other ride"}</span>{data.support?.length > 0 && <span><Accessibility size={15} />{data.support.map((key) => SUPPORT_LABELS[key]).join("; ")}</span>}<span><Users size={15} />{data.companion_count || 0} additional travellers</span>{data.fare_support && <span>Travel-cost help requested</span>}</div>
      {data.arranged_via && <p><b>Arranged via:</b> {data.arranged_via}{data.confirmed_pickup_at ? ` · Pickup ${dateTime(data.confirmed_pickup_at)}` : ""}</p>}
      {data.coordination_note && <p className="ob-transport-note"><b>Care-team update:</b> {data.coordination_note}</p>}
      {data.notes && <p><b>Your note:</b> {data.notes}</p>}
      {data.location_consent && !["completed", "cancelled", "unable"].includes(item.status) && <div className="ob-live-location-controls">
        <p className="small muted">Trip location: {watchId !== null ? "sharing from this page" : data.location_sharing === "active" ? "active; resume updates here if this page was reopened" : "not started"}. Updates stop when you stop sharing or the link expires.</p>
        {watchId === null
          ? <button className="btn" type="button" disabled={trackingBusy} onClick={startSharing}><MapPin size={16} />{trackingBusy ? "Starting…" : data.location_sharing === "active" ? "Resume trip location" : "Start trip location"}</button>
          : <button className="btn" type="button" disabled={trackingBusy} onClick={stopSharing}><Check size={16} />{trackingBusy ? "Stopping…" : "Stop sharing"}</button>}
        <Error message={trackingError} />
      </div>}
      {!['completed', 'cancelled'].includes(item.status) && <><button className="btn" type="button" onClick={async () => { setError(""); try { if (watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId); await request(`/v2/transport-requests/${item.id}/cancel`, "POST"); onUpdate(); } catch (e) { setError(e.message); } }}>Cancel request</button><Error message={error} /></>}
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

