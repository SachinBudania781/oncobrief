import { CalendarDays, Check, FileHeart, HeartPulse, ShieldCheck } from "lucide-react";

// Decorative, code-native artwork: no external images or patient information.
export default function CareMotif({ portal = "patient", compact = false }) {
  return <div className={`care-motif ${compact ? "compact" : ""}`} aria-hidden="true">
    <div className="motif-halo motif-halo-one" />
    <div className="motif-halo motif-halo-two" />
    <div className="motif-card">
      <div className="motif-card-top"><span className="motif-icon"><HeartPulse size={24} strokeWidth={1.5} /></span><span>OncoBrief<small>A connected care story</small></span><span className="motif-check"><Check size={15} /></span></div>
      <svg className="motif-wave" viewBox="0 0 300 70" fill="none"><path className="motif-wave-base" d="M0 38H55L72 38 86 15 106 58 125 29 138 38H175L188 38 201 23 214 48 227 38H300" /><path className="motif-wave-trace" d="M0 38H55L72 38 86 15 106 58 125 29 138 38H175L188 38 201 23 214 48 227 38H300" /></svg>
      <div className="motif-card-bottom"><span><i />Records</span><span><i />Care team</span><span><i />Next steps</span></div>
    </div>
    <div className="motif-float motif-record"><FileHeart size={19} /><span>Your story.<b>All together.</b></span></div>
    <div className="motif-float motif-visit">{portal === "doctor" ? <ShieldCheck size={19} /> : <CalendarDays size={19} />}<span>{portal === "doctor" ? "Clearer decisions" : portal === "staff" ? "Smoother handovers" : "Closer to your team"}</span></div>
    <div className="motif-plus motif-plus-one">+</div><div className="motif-plus motif-plus-two">+</div>
  </div>;
}
