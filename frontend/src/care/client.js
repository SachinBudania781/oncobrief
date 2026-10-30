import { useCallback, useEffect, useState } from "react";

export async function request(path, method = "GET", body) {
  const form = body instanceof FormData;
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body && !form ? { "Content-Type": "application/json" } : {},
    ...(body ? { body: form ? body : JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    let error;
    try {
      error = (await response.json()).detail;
    } catch {
      error = response.statusText;
    }
    if (response.status === 401 && !path.startsWith("/auth/"))
      window.dispatchEvent(new Event("ob-session-expired"));
    throw new Error(typeof error === "string" ? error : JSON.stringify(error));
  }
  return response.json();
}

export function useResource(path, interval = 0) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((v) => v + 1), []);
  useEffect(() => {
    if (!path) {
      setData(null);
      setError("");
      return;
    }
    let live = true;
    setData(null);
    setBusy(true);
    setError("");
    const load = () =>
      request(path)
        .then((v) => {
          if (live) {
            setData(v);
            setError("");
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        })
        .finally(() => {
          if (live) setBusy(false);
        });
    load();
    const timer = interval ? setInterval(load, interval) : null;
    return () => {
      live = false;
      if (timer) clearInterval(timer);
    };
  }, [path, interval, revision]);
  return { data, error, busy, refresh, enabled: Boolean(path) };
}

export const dateTime = (value) =>
  value
    ? new Date(
        value.includes("T") ? value : value + "T00:00:00",
      ).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
    : "Not recorded";

export function hospitalDateTime(value) {
  if (!value) return "Not recorded";
  const text = String(value);
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) return dateTime(text);
  const wallTime = text.length === 10 ? `${text}T00:00:00Z` : `${text.replace(" ", "T")}Z`;
  const date = new Date(wallTime);
  return Number.isNaN(date.getTime())
    ? dateTime(text)
    : date.toLocaleString("en-IN", {
        dateStyle: "medium",
        ...(text.length === 10 ? {} : { timeStyle: "short" }),
        timeZone: "UTC",
      });
}

export const nice = (key) => key?.replaceAll("_", " ");

export function speak(text, language = "en") {
  if (!window.speechSynthesis)
    throw new Error(
      "Speech playback is unavailable in this browser. The text remains available.",
    );
  window.speechSynthesis.cancel();
  const speech = new SpeechSynthesisUtterance(text);
  speech.lang = { en: "en-IN", hi: "hi-IN", mr: "mr-IN" }[language] || "en-IN";
  window.speechSynthesis.speak(speech);
}
