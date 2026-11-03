import { useResource } from "./client";

export default function MemoryUpLink({ pid, appointmentId }) {
  const feature = useResource("/memory-up/context");
  if (!feature.data?.patients?.length) return null;
  const query = new URLSearchParams();
  if (pid) query.set("patient_id", pid);
  if (appointmentId) query.set("appointment_id", appointmentId);
  return <a className="btn" href={`/memory-up?${query}`}>
    Memory Up · appointment advice
  </a>;
}

