import { useResource } from "./client";

export default function MemoryUpLink({ pid }) {
  const feature = useResource("/memory-up/context");
  if (!feature.data?.patients?.length) return null;
  return <a className="btn" href={`/memory-up${pid ? `?patient_id=${encodeURIComponent(pid)}` : ""}`}>
    Memory Up · appointment advice
  </a>;
}
