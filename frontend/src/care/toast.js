// Tiny event-based toast bus so any component can confirm an action.
export function toast(message, tone = "success") {
  window.dispatchEvent(new CustomEvent("ob-toast", { detail: { message, tone, id: Date.now() + Math.random() } }));
}
