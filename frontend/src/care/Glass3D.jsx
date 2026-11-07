import { useEffect, useId, useRef } from "react";

/* Glossy 3D glass art, drawn in SVG so it stays crisp and animates on any screen. */

const PLUS = "M38 6h24a10 10 0 0 1 10 10v22h22a10 10 0 0 1 10 10v24a10 10 0 0 1-10 10H72v22a10 10 0 0 1-10 10H38a10 10 0 0 1-10-10V82H6A10 10 0 0 1-4 72V48a10 10 0 0 1 10-10h22V16A10 10 0 0 1 38 6z";

export function GlassCross({ size = 220, hue = "blue", className = "" }) {
  const id = useId().replace(/:/g, "");
  const palette = {
    blue: ["#e8f4ff", "#9fd0ff", "#4b8dff", "#2f5bea", "#1b3fb8"],
    teal: ["#e7fffb", "#9df0e4", "#2ec4c4", "#0f8f9a", "#0a6670"],
    violet: ["#f3edff", "#cdb8ff", "#8f6bff", "#5b3fe0", "#3b25a8"],
    pink: ["#fff0f7", "#ffc2e0", "#ff7ab8", "#e0479a", "#a52a70"],
  }[hue] || [];
  const depth = 9;
  return <div className={`ob-glass3d ob-glass-cross ${className}`} style={{ width: size, height: size }} aria-hidden="true">
    <svg viewBox="-24 -14 148 148" width="100%" height="100%">
      <defs>
        <linearGradient id={`${id}f`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={palette[0]} stopOpacity=".95" />
          <stop offset=".35" stopColor={palette[1]} stopOpacity=".85" />
          <stop offset=".75" stopColor={palette[2]} stopOpacity=".78" />
          <stop offset="1" stopColor={palette[3]} stopOpacity=".9" />
        </linearGradient>
        <linearGradient id={`${id}d`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={palette[2]} />
          <stop offset="1" stopColor={palette[4]} />
        </linearGradient>
        <linearGradient id={`${id}r`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".95" />
          <stop offset=".45" stopColor="#fff" stopOpacity=".1" />
          <stop offset="1" stopColor="#fff" stopOpacity=".55" />
        </linearGradient>
        <radialGradient id={`${id}s`} cx=".3" cy=".22" r=".5">
          <stop offset="0" stopColor="#fff" stopOpacity=".9" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <filter id={`${id}b`} x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="7" /></filter>
        <clipPath id={`${id}c`}><path d={PLUS} /></clipPath>
      </defs>
      <ellipse cx="52" cy="128" rx="48" ry="7" fill={palette[3]} opacity=".22" filter={`url(#${id}b)`} />
      {Array.from({ length: depth }, (_, i) => <path key={i} d={PLUS} transform={`translate(${(depth - i) * 1.1} ${(depth - i) * 1.4})`} fill={`url(#${id}d)`} opacity={0.55 + i * 0.04} />)}
      <path d={PLUS} fill={`url(#${id}f)`} />
      <g clipPath={`url(#${id}c)`}>
        <ellipse cx="30" cy="22" rx="46" ry="30" fill={`url(#${id}s)`} />
        <path d="M-10 70 Q 40 40 110 62 L110 120 L-10 120Z" fill={palette[4]} opacity=".12" />
        <rect x="34" y="12" width="7" height="104" rx="3.5" fill="#fff" opacity=".35" transform="rotate(-24 52 64)" />
      </g>
      <path d={PLUS} fill="none" stroke={`url(#${id}r)`} strokeWidth="1.6" />
    </svg>
  </div>;
}

export function GlassOrb({ size = 180, colors = ["#7ee8fa", "#5b8cff", "#a66bff"], className = "", children, pulse = false }) {
  const id = useId().replace(/:/g, "");
  return <div className={`ob-glass3d ob-glass-orb ${pulse ? "pulse" : ""} ${className}`} style={{ width: size, height: size, "--orb-glow": colors[1] }}>
    <svg viewBox="0 0 200 200" width="100%" height="100%" aria-hidden="true">
      <defs>
        <radialGradient id={`${id}a`} cx=".35" cy=".3" r=".75">
          <stop offset="0" stopColor="#fff" stopOpacity=".95" />
          <stop offset=".18" stopColor={colors[0]} />
          <stop offset=".62" stopColor={colors[1]} />
          <stop offset="1" stopColor={colors[2]} />
        </radialGradient>
        <radialGradient id={`${id}h`} cx=".32" cy=".2" r=".32">
          <stop offset="0" stopColor="#fff" stopOpacity=".95" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}r`} cx=".7" cy=".82" r=".4">
          <stop offset="0" stopColor="#fff" stopOpacity=".55" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <filter id={`${id}b`}><feGaussianBlur stdDeviation="9" /></filter>
      </defs>
      <ellipse cx="100" cy="188" rx="58" ry="8" fill={colors[2]} opacity=".25" filter={`url(#${id}b)`} />
      <circle cx="100" cy="96" r="84" fill={`url(#${id}a)`} />
      <ellipse className="ob-orb-swirl" cx="100" cy="110" rx="70" ry="26" fill="none" stroke="#fff" strokeOpacity=".22" strokeWidth="10" transform="rotate(-18 100 110)" />
      <circle cx="100" cy="96" r="84" fill={`url(#${id}r)`} />
      <ellipse cx="72" cy="54" rx="38" ry="24" fill={`url(#${id}h)`} transform="rotate(-24 72 54)" />
      <circle cx="100" cy="96" r="83" fill="none" stroke="#fff" strokeOpacity=".5" strokeWidth="1.5" />
    </svg>
    {children && <div className="ob-orb-content">{children}</div>}
  </div>;
}

/* Soft animated colour field used behind heroes and pages. */
export function Aurora({ tone = "patient" }) {
  return <div className={`ob-aurora tone-${tone}`} aria-hidden="true"><i /><i /><i /></div>;
}

/* Pointer-driven 3D tilt for hero cards. */
export function useTilt(strength = 8) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches || window.matchMedia("(hover: none)").matches) return;
    const move = (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      el.style.setProperty("--rx", `${(-y * strength).toFixed(2)}deg`);
      el.style.setProperty("--ry", `${(x * strength).toFixed(2)}deg`);
      el.style.setProperty("--gx", `${((x + 0.5) * 100).toFixed(1)}%`);
      el.style.setProperty("--gy", `${((y + 0.5) * 100).toFixed(1)}%`);
    };
    const leave = () => { el.style.setProperty("--rx", "0deg"); el.style.setProperty("--ry", "0deg"); };
    el.addEventListener("pointermove", move); el.addEventListener("pointerleave", leave);
    return () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerleave", leave); };
  }, [strength]);
  return ref;
}

/* Glossy fades at the top and bottom of the viewport that appear while content scrolls under them. */
export function ScrollGloss() {
  useEffect(() => {
    const update = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      document.documentElement.style.setProperty("--ob-scroll-top", Math.min(window.scrollY / 60, 1).toFixed(2));
      document.documentElement.style.setProperty("--ob-scroll-bottom", Math.min(Math.max(max - window.scrollY, 0) / 60, 1).toFixed(2));
    };
    update();
    window.addEventListener("scroll", update, { passive: true }); window.addEventListener("resize", update);
    const t = setInterval(update, 800);
    return () => { window.removeEventListener("scroll", update); window.removeEventListener("resize", update); clearInterval(t); };
  }, []);
  return <><div className="ob-gloss-top" aria-hidden="true" /><div className="ob-gloss-bottom" aria-hidden="true" /></>;
}
