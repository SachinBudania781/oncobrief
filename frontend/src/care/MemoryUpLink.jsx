import { useResource } from "./client";
import { ArrowUpRight, BookOpenText } from "lucide-react";

export default function MemoryUpLink({ pid, appointmentId }) {
  const feature = useResource("/memory-up/context");
  if (!feature.data?.patients?.length) return null;
  const query = new URLSearchParams();
  if (pid) query.set("patient_id", pid);
  if (appointmentId) query.set("appointment_id", appointmentId);
  return <a className="care-memory-link" aria-label="Memory Up · appointment advice" href={`/memory-up/?${query}`}>
    <span className="dashboard-icon"><BookOpenText size={20} /></span><span><b>Memory Up</b><small>Your appointment advice, kept close.</small></span><ArrowUpRight size={18} />
  </a>;
}

