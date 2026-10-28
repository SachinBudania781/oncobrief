import { useEffect, useRef, useState } from "react";
import {
  Bot,
  MessageCircle,
  Mic,
  Send,
  ShieldCheck,
  Sparkles,
  Volume2,
  X,
} from "lucide-react";
import { request, speak } from "./client";
import { Emergency } from "./PatientTools";
import { Error, SourceLinks, Status } from "./UI";

const levelNames = ["inform", "everyday_guidance", "doctor_review", "emergency"];

export default function AIAssistantWidget({ pid, language = "en", onOpen }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("type");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const recognition = useRef(null);
  const logRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    recognition.current?.abort();
    window.speechSynthesis?.cancel();
    setListening(false);
    setMessages([]);
    setDraft("");
    setError("");
  }, [pid]);

  useEffect(() => () => {
    recognition.current?.abort();
    window.speechSynthesis?.cancel();
  }, []);

  useEffect(() => {
    if (open && mode === "type") inputRef.current?.focus();
  }, [open, mode]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages, busy, listening]);

  const ask = async (question, spoken = false) => {
    const clean = question.trim();
    if (!clean || busy) return;
    setDraft("");
    setError("");
    setMessages((items) => [...items, { id: "q-" + Date.now(), role: "user", text: clean }]);
    setBusy(true);
    try {
      const result = await request("/v2/patients/" + pid + "/companion", "POST", {
        text: clean,
        language,
      });
      setMessages((items) => [...items, { id: "a-" + Date.now(), role: "assistant", result }]);
      if (spoken) {
        try { speak(result.level === 3 ? (result.instruction || result.answer) : result.answer, language); }
        catch (e) { setError(e.message); }
      }
    } catch (e) {
      setError(e.message || "I couldn’t reach your care folder. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const startVoice = () => {
    setError("");
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Voice input isn’t available in this browser. Choose Type to continue.");
      return;
    }
    const recorder = new SpeechRecognition();
    recorder.lang = { en: "en-IN", hi: "hi-IN", mr: "mr-IN" }[language] || "en-IN";
    recorder.interimResults = false;
    recorder.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim();
      setListening(false);
      if (transcript) ask(transcript, true);
    };
    recorder.onerror = (event) => {
      if (event.error === "aborted") return;
      setError(event.error === "network" ? "Your browser could not reach its speech service. Check your connection and try again, or choose Type." : event.error === "not-allowed"
        ? "Microphone access was blocked. Allow it in your browser settings, or choose Type."
        : "Voice input: " + event.error + ". You can choose Type to continue.");
      setListening(false);
    };
    recorder.onend = () => setListening(false);
    recognition.current = recorder;
    try {
      recorder.start();
      setListening(true);
    } catch (e) {
      setError(e.message || "Voice input couldn’t start. Choose Type to continue.");
    }
  };

  const submit = (event) => {
    event.preventDefault();
    ask(draft);
  };

  const closeAssistant = () => {
    recognition.current?.abort();
    window.speechSynthesis?.cancel();
    setListening(false);
    setOpen(false);
  };
  return (
    <div className="care-ai-assistant">
      {open && (
        <section className="care-ai-window" role="dialog" aria-label="OncoBrief AI assistant">
          <header className="care-ai-head">
            <div className="care-ai-identity">
              <span className="care-ai-avatar"><Sparkles size={19} /></span>
              <span><b>OncoBrief assistant</b><small><i /> Grounded in your care folder</small></span>
            </div>
            <button className="care-ai-close" aria-label="Close assistant" onClick={closeAssistant}><X size={19} /></button>
          </header>

          <div className="care-ai-tabs" role="tablist" aria-label="Choose how to chat">
            <button role="tab" aria-selected={mode === "type"} className={mode === "type" ? "active" : ""} onClick={() => { setMode("type"); setListening(false); recognition.current?.abort(); window.speechSynthesis?.cancel(); }}>
              <MessageCircle size={15} /> Type
            </button>
            <button role="tab" aria-selected={mode === "talk"} className={mode === "talk" ? "active" : ""} onClick={() => { setMode("talk"); setError(""); }}>
              <Mic size={15} /> Talk
            </button>
          </div>

          <div className="care-ai-log" ref={logRef} aria-live="polite" aria-relevant="additions text">
            {!messages.length && (
              <div className="care-ai-welcome">
                <span className="care-ai-welcome-icon"><Bot size={21} /></span>
                <h3>How can I help today?</h3>
                <p>Ask about a report in your folder or get help preparing for your next visit.</p>
                <div className="care-ai-prompts">
                  <button onClick={() => ask("Summarize my latest report")}>Summarize my latest report <span>↗</span></button>
                  <button onClick={() => ask("What should I ask my doctor at my next visit?")}>Help me prepare for my visit <span>↗</span></button>
                </div>
              </div>
            )}
            {messages.map((message) => (
              <article key={message.id} className={"care-ai-message " + message.role}>
                {message.role === "user" ? <p>{message.text}</p> : (
                  <div className="care-ai-answer">
                    {message.result.level === 3 ? <Emergency result={message.result} /> : <>
                      {message.result.citations?.length ? message.result.citations.map((citation, index) => (
                        <div className="care-ai-citation" key={index}>
                          <p>{citation.text}</p>
                          <SourceLinks sources={(message.result.sources || []).filter((source) => citation.sources?.includes(source.tag))} onOpen={onOpen} />
                        </div>
                      )) : <><p>{message.result.answer}</p><SourceLinks sources={message.result.sources} onOpen={onOpen} /></>}
                      <div className="care-ai-answer-foot">
                        <Status value={levelNames[message.result.level] || "inform"} />
                        <span>{message.result.generation === "ai" ? "AI-assisted" : "From your records"}</span>
                        <button aria-label="Listen to answer" title="Listen to answer" onClick={() => { try { speak(message.result.answer, language); } catch (e) { setError(e.message); } }}><Volume2 size={15} /></button>
                      </div>
                    </>}
                  </div>
                )}
              </article>
            ))}
            {busy && <div className="care-ai-thinking"><span><i /><i /><i /></span>Checking your care folder…</div>}
            {listening && <div className="care-ai-thinking care-ai-listening"><span><i /><i /><i /></span>Listening for your question…</div>}
          </div>

          <div className="care-ai-compose">
            <Error message={error} />
            {mode === "type" ? (
              <form onSubmit={submit} className="care-ai-form">
                <label className="care-ai-sr-only" htmlFor="care-ai-input">Type your question</label>
                <textarea id="care-ai-input" ref={inputRef} rows={1} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(event); } }} placeholder="Ask about your care…" disabled={busy} />
                <button type="submit" aria-label="Send message" disabled={!draft.trim() || busy}><Send size={17} /></button>
              </form>
            ) : (
              <div className="care-ai-talk">
                <button className={"care-ai-mic " + (listening ? "listening" : "")} onClick={startVoice} disabled={busy} aria-label={listening ? "Stop listening" : "Start voice chat"}>
                  {listening ? <span className="care-ai-stop" /> : <Mic size={20} />}
                </button>
                <div><b>{listening ? "I’m listening" : "Tap to ask out loud"}</b><span>Your reply will be read aloud.</span></div>
              </div>
            )}
            <div className="care-ai-privacy"><ShieldCheck size={12} /> Care-folder access follows your account <span>·</span> Voice uses browser speech</div>
          </div>
        </section>
      )}

      <button className={"care-ai-launcher " + (open ? "is-open" : "")} aria-label={open ? "Close AI assistant" : "Open AI assistant"} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {open ? <X size={22} /> : <><MessageCircle size={22} /><span className="care-ai-launcher-spark"><Sparkles size={11} /></span></>}
        {!open && <span className="care-ai-launcher-label">Ask AI</span>}
      </button>
    </div>
  );
}
