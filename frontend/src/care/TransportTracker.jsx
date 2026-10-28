import { ExternalLink, MapPin } from "lucide-react";
import { useParams } from "react-router-dom";
import { dateTime, useResource } from "./client";
import { Empty, Error, Load, Panel } from "./UI";

export default function TransportTracker() {
  const { token } = useParams();
  const resource = useResource(`/shared/transport/${encodeURIComponent(token)}`, 15000);
  return (
    <div className="care-shared-page ob-transport-tracker">
      <Panel title="OncoBrief · live trip location" hint="This private link shows only the latest location shared by the patient.">
        <Load resource={resource}>
          {(trip) => (
            <div className="stack">
              {trip.status === "active" && trip.location ? (
                <>
                  <div className="ob-tracker-pin"><MapPin size={25} /><div><b>Latest shared location</b><span>Updated {dateTime(trip.updated_at)}</span></div></div>
                  <a className="btn primary" href={`https://maps.google.com/?q=${trip.location.latitude},${trip.location.longitude}`} target="_blank" rel="noopener noreferrer">
                    View on map <ExternalLink size={16} />
                  </a>
                  {trip.location.accuracy_m != null && <p className="small muted">Device reported accuracy: approximately {Math.round(trip.location.accuracy_m)} m.</p>}
                  <p className="small muted">This page refreshes while it stays open. Location updates depend on the patient’s browser and device availability.</p>
                </>
              ) : trip.status === "active" ? (
                <Empty>The patient has started sharing. Waiting for the first location update…</Empty>
              ) : (
                <Empty>The patient has not started sharing trip location yet.</Empty>
              )}
              <p className="small muted">Link expires {dateTime(trip.expires_at)}. The patient can stop sharing at any time.</p>
            </div>
          )}
        </Load>
        <Error message={resource.error} />
      </Panel>
    </div>
  );
}

