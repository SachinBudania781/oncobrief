import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export default function Modal({ title, children, onClose, className = "" }) {
  const ref = useRef(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () => [...ref.current.querySelectorAll('button, a[href], input, select, textarea, [tabindex="0"]')].filter(el => !el.disabled && el.getClientRects().length);
    (ref.current.querySelector("[data-autofocus]") || focusable()[0] || ref.current).focus();
    const keydown = e => {
      if ([...document.querySelectorAll(".care-modal")].at(-1) !== ref.current) return;
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const items = focusable(), first = items[0], last = items.at(-1);
        if (!items.length) { e.preventDefault(); ref.current.focus(); }
        else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", keydown);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return createPortal(
    <div className={`care-modal-backdrop ${className}`} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="care-modal" ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="care-modal-head"><h2 id={titleId}>{title}</h2><button className="btn icon-btn" aria-label={`Close ${title}`} onClick={onClose}><X size={20} /></button></header>
        <div className="care-modal-content">{children}</div>
      </section>
    </div>, document.body,
  );
}
