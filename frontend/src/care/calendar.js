// Calendar helpers. Appointment times from the API are hospital wall time (IST),
// sometimes written with a trailing "Z", so the zone is stated explicitly instead.
const ZONE = "Asia/Kolkata";

const wall = (value) => String(value || "").replace(/Z$|[+-]\d{2}:?\d{2}$/, "").replace(" ", "T").slice(0, 16);
const compact = (value) => wall(value).replace(/[-:]/g, "") + "00";

function addMinutes(value, minutes) {
  const [d, t = "00:00"] = wall(value).split("T");
  const [y, m, day] = d.split("-").map(Number);
  const [h, min] = t.split(":").map(Number);
  const date = new Date(Date.UTC(y, m - 1, day, h, min + minutes));
  return date.toISOString().slice(0, 16);
}

export function eventFor(appointment) {
  const start = appointment.start || appointment.scheduled_at;
  const end = appointment.end || addMinutes(start, 30);
  const meet = appointment.virtual_visit?.meeting_url;
  const title = `${appointment.department || "Hospital visit"}${appointment.clinician && !/pending/i.test(appointment.clinician) ? ` · ${appointment.clinician}` : ""}`;
  const where = meet || [appointment.room, appointment.department].filter(Boolean).join(", ");
  const details = [appointment.notes, meet ? `Join: ${meet}` : "", "Managed in OncoBrief"].filter(Boolean).join("\n");
  return { start, end, title, where, details };
}

export function googleCalendarUrl(appointment) {
  const e = eventFor(appointment);
  const params = new URLSearchParams({ action: "TEMPLATE", text: e.title, dates: `${compact(e.start)}/${compact(e.end)}`, details: e.details, location: e.where, ctz: ZONE });
  return `https://calendar.google.com/calendar/render?${params}`;
}

export function downloadIcs(appointment) {
  const e = eventFor(appointment);
  const esc = (s) => String(s || "").replace(/[\\,;]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//OncoBrief//Care//EN", "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
    `UID:oncobrief-${appointment.id || Date.now()}@oncobrief`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
    `DTSTART;TZID=${ZONE}:${compact(e.start)}`, `DTEND;TZID=${ZONE}:${compact(e.end)}`,
    `SUMMARY:${esc(e.title)}`, `LOCATION:${esc(e.where)}`, `DESCRIPTION:${esc(e.details)}`,
    "BEGIN:VALARM", "TRIGGER:-PT1H", "ACTION:DISPLAY", "DESCRIPTION:Hospital appointment in 1 hour", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: "oncobrief-appointment.ics" });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Minutes from "now" (hospital wall time) until an appointment start.
export function minutesUntil(value, now = new Date()) {
  const local = new Date(now.toLocaleString("en-US", { timeZone: ZONE }));
  const [d, t = "00:00"] = wall(value).split("T");
  const [y, m, day] = d.split("-").map(Number);
  const [h, min] = t.split(":").map(Number);
  return Math.round((new Date(y, m - 1, day, h, min) - local) / 60000);
}

export function wallTimeLabel(value) {
  const [d, t = "00:00"] = wall(value).split("T");
  const [y, m, day] = d.split("-").map(Number);
  const [h, min] = t.split(":").map(Number);
  return new Date(y, m - 1, day, h, min).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export function wallClock(value) {
  const [, t = "00:00"] = wall(value).split("T");
  const [h, min] = t.split(":").map(Number);
  return new Date(2000, 0, 1, h, min).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}
