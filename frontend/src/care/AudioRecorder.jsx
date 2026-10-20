import { useEffect, useRef, useState } from "react";
import { request } from "./client";

export default function AudioRecorder({ pid, onSaved }) {
  const [recording, setRecording] = useState(false),
    [audio, setAudio] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const recorder = useRef(null),
    stream = useRef(null),
    chunks = useRef([]),
    timer = useRef(null);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      recorder.current?.state === "recording" && recorder.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
      if (audio) URL.revokeObjectURL(audio.url);
    },
    [audio],
  );
  const start = async () => {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError(
        "Audio recording is unavailable. Type the loved one’s message instead.",
      );
      return;
    }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      const mime = ["audio/webm", "audio/ogg"].find((m) =>
        MediaRecorder.isTypeSupported(m),
      );
      const r = new MediaRecorder(
        stream.current,
        mime ? { mimeType: mime } : undefined,
      );
      chunks.current = [];
      recorder.current = r;
      r.ondataavailable = (e) => chunks.current.push(e.data);
      r.onstop = () => {
        const blob = new Blob(chunks.current, { type: r.mimeType });
        setAudio({ blob, url: URL.createObjectURL(blob) });
        setRecording(false);
        stream.current.getTracks().forEach((t) => t.stop());
      };
      r.start();
      setRecording(true);
      timer.current = setTimeout(
        () => r.state === "recording" && r.stop(),
        60000,
      );
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <div className="stack">
      <p className="small muted">
        Record a message in a loved one's voice (up to 60 seconds). With your
        consent it is stored in the patient folder.
      </p>
      <div className="row">
        <button
          className="btn"
          type="button"
          onClick={
            recording
              ? () => {
                  clearTimeout(timer.current);
                  recorder.current.stop();
                }
              : start
          }
        >
          {recording ? "Stop recording" : "Record family voice"}
        </button>
        {audio && <audio controls src={audio.url} />}
      </div>
      {audio && (
        <button
          className="btn"
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const f = new FormData();
              f.append("file", audio.blob, "family-voice.webm");
              const r = await request(
                `/v2/patients/${pid}/voice-reminder`,
                "POST",
                f,
              );
              onSaved(r.document_id);
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving…" : "Consent & save voice message"}
        </button>
      )}
      {error && (
        <p className="care-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
