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

function newConversationId() {
  return window.crypto?.randomUUID?.() || `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function AIAssistantWidget({ pid, language = "en", onOpen, embedded = false, userRole = "patient" }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("type");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const [sharing, setSharing] = useState(false);
  const [sharingBusy, setSharingBusy] = useState(false);
  const [sharingError, setSharingError] = useState("");
  const recognition = useRef(null);
  const voiceSession = useRef(false);
  const restartTimer = useRef(null);
  const conversationId = useRef(newConversationId());
  const logRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    recognition.current?.abort();
    window.speechSynthesis?.cancel();
    setListening(false);
    setMessages([]);
    setDraft("");
    setError("");
    conversationId.current = newConversationId();
    voiceSession.current = false;
    clearTimeout(restartTimer.current);
    setSharing(false);
    setSharingError("");
    if (userRole === "patient") {
      request("/v2/patients/" + pid + "/companion-sharing")
        .then((result) => setSharing(Boolean(result.enabled)))
        .catch((e) => setSharingError(e.message));
    }
  }, [pid, userRole]);

  useEffect(() => () => {
    recognition.current?.abort();
    voiceSession.current = false;
    clearTimeout(restartTimer.current);
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
        conversation_id: conversationId.current,
      });
      setMessages((items) => [...items, { id: "a-" + Date.now(), role: "assistant", result }]);
      if (spoken) {
        try {
          const responseText = result.level === 3 ? (result.instruction || result.answer) : result.answer;
          if (!window.speechSynthesis) throw new Error("Speech playback is unavailable in this browser.");
          await new Promise((resolve) => {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(responseText);
            utterance.lang = { en: "en-IN", hi: "hi-IN", mr: "mr-IN" }[language] || "en-IN";
            utterance.onend = resolve;
            utterance.onerror = resolve;
            window.speechSynthesis.speak(utterance);
          });
        }
        catch (e) { setError(e.message); }
      }
    } catch (e) {
      setError(e.message || "I couldn’t reach your care folder. Please try again.");
    } finally {
      setBusy(false);
      if (spoken && voiceSession.current) restartTimer.current = setTimeout(listenOnce, 350);
    }
  };

  const listenOnce = () => {
    setError("");
    if (!voiceSession.current) return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      voiceSession.current = false;
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
      voiceSession.current = false;
      setListening(false);
    };
    recorder.onend = () => setListening(false);
    recognition.current = recorder;
    try {
      recorder.start();
      setListening(true);
    } catch (e) {
      setError(e.message || "Voice input couldn’t start. Choose Type to continue.");
      voiceSession.current = false;
    }
  };

  const startVoice = () => {
    setError("");
    if (voiceSession.current) {
      voiceSession.current = false;
      clearTimeout(restartTimer.current);
      recognition.current?.stop();
      window.speechSynthesis?.cancel();
      setListening(false);
      return;
    }
    voiceSession.current = true;
    listenOnce();
  };

  const submit = (event) => {
    event.preventDefault();
    ask(draft);
  };

  const closeAssistant = () => {
    voiceSession.current = false;
    clearTimeout(restartTimer.current);
    recognition.current?.abort();
    window.speechSynthesis?.cancel();
    setListening(false);
    setOpen(false);
  };
  const updateSharing = async (event) => {
    const enabled = event.target.checked;
    setSharingBusy(true);
    setSharingError("");
    try {
      const result = await request("/v2/patients/" + pid + "/companion-sharing", "PUT", { enabled });
      setSharing(Boolean(result.enabled));
    } catch (e) {
      setSharingError(e.message || "Your sharing preference could not be saved.");
    } finally {
      setSharingBusy(false);
    }
  };
  const visible = embedded || open;
  return (
    <div className={"care-ai-assistant " + (embedded ? "care-ai-embedded" : "")}>
      {visible && (
        <section className={"care-ai-window " + (embedded ? "care-ai-window-embedded" : "")} role="region" aria-label="OncoBrief AI chat">
          <header className="care-ai-head">
            <div className="care-ai-identity">
              <span className="care-ai-avatar"><Sparkles size={19} /></span>
              <span><b>AI Chat</b><small><i /> {userRole === "doctor" ? "Care-folder answers · patient-shared insights" : "Your care folder · here to help"}</small></span>
            </div>
            {!embedded && <button className="care-ai-close" aria-label="Close assistant" onClick={closeAssistant}><X size={19} /></button>}
          </header>

          <div className="care-ai-tabs" role="tablist" aria-label="Choose how to chat">
            <button role="tab" aria-selected={mode === "type"} className={mode === "type" ? "active" : ""} onClick={() => { voiceSession.current = false; clearTimeout(restartTimer.current); setMode("type"); setListening(false); recognition.current?.abort(); window.speechSynthesis?.cancel(); }}>
              <MessageCircle size={15} /> Type
            </button>
            <button role="tab" aria-selected={mode === "talk"} className={mode === "talk" ? "active" : ""} onClick={() => { setMode("talk"); setError(""); }}>
              <Mic size={15} /> Talk
            </button>
          </div>

          {userRole === "patient" && <div className="care-ai-sharing">
            <label><input type="checkbox" checked={sharing} disabled={sharingBusy} onChange={updateSharing} />
              <span><b>Share chat excerpts with my care team</b><small>Only your questions from now on. Turn this off any time.</small></span>
            </label>
            {sharingError && <small role="alert">{sharingError}</small>}
          </div>}

          <div className="care-ai-log" ref={logRef} aria-live="polite" aria-relevant="additions text">
            {!messages.length && (
              <div className="care-ai-welcome">
                <span className="care-ai-welcome-icon"><Bot size={21} /></span>
                <h3>How can I help today?</h3>
                <p>{userRole === "doctor"
                  ? "Ask about this patient’s records, or review chat excerpts the patient has chosen to share."
                  : "Ask about your records, get help with everyday questions, or prepare for your next visit."}</p>
                <div className="care-ai-prompts">
                  {userRole === "doctor" ? <>
                    <button onClick={() => ask("Summarize the records relevant to this patient's current care")}>Summarize patient records <span>↗</span></button>
                    <button onClick={() => ask("What has the patient chosen to share in AI Chat recently?")}>Review shared chat excerpts <span>↗</span></button>
                  </> : <>
                    <button onClick={() => ask("Summarize my latest report")}>Summarize my latest report <span>↗</span></button>
                    <button onClick={() => ask("Help me prepare for my next visit")}>Help me prepare for my visit <span>↗</span></button>
                  </>}
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
                <button className={"care-ai-mic " + (listening ? "listening" : "")} onClick={startVoice} disabled={busy && !voiceSession.current} aria-label={voiceSession.current ? "Stop voice conversation" : "Start voice conversation"}>
                  {listening ? <span className="care-ai-stop" /> : <Mic size={20} />}
                </button>
                <div><b>{listening ? "I’m listening" : voiceSession.current && busy ? "Preparing your reply…" : voiceSession.current ? "Conversation paused" : "Tap to start talking"}</b><span>{voiceSession.current ? "I’ll listen again after each reply. Tap stop to end." : "Your reply will be read aloud."}</span></div>
              </div>
            )}
            <div className="care-ai-privacy"><ShieldCheck size={12} /> {userRole === "doctor" ? "Patient chat is hidden unless they share it" : "Care-folder access follows your account"} <span>·</span> Voice uses browser speech</div>
          </div>
        </section>
      )}

      {!embedded && <button className={"care-ai-launcher " + (open ? "is-open" : "")} aria-label={open ? "Close AI assistant" : "Open AI assistant"} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {open ? <X size={22} /> : <><MessageCircle size={22} /><span className="care-ai-launcher-spark"><Sparkles size={11} /></span></>}
        {!open && <span className="care-ai-launcher-label">Ask AI</span>}
      </button>}
    </div>
  );
}
