"use client";
import { useState, useEffect, useRef, useCallback } from "react";

/* ——— Types ———————————————————————————————————————————————————————————— */
interface Contact { id: string; name: string; email?: string; phone?: string; }
interface Opportunity { id: string; name: string; status: string; pipelineName: string; stageName: string; monetaryValue: number; jtJobId: string; }
interface ChatMsg { id: string; role: "user" | "assistant"; content: string; ts: number; agent?: string; }
interface Tpl { id: string; title: string; prompt: string; icon: string; }
type MeetingType = "" | "Client Meeting" | "Internal" | "Trade" | "Other";
type Tab = "notes" | "chat";

const TEMPLATES: Tpl[] = [
  { id: "overview", title: "Project Overview", icon: "\u{1F4CB}", prompt: "Give me a summary overview of the latest communication with this client \u2014 current TO DO items, what the client is expecting, and pending decisions." },
  { id: "todos", title: "Meeting To-Dos", icon: "\u2705", prompt: "Pull the notes from the most recent meeting and list out all action items and to-do tasks that were mentioned." },
  { id: "jt-jobs", title: "JobTread Status", icon: "\u{1F3D7}\uFE0F", prompt: "Show me all the active jobs in JobTread with their current status." },
  { id: "create-task", title: "Create Task", icon: "\u{1F4DD}", prompt: "I need to create a new task in JobTread." },
];

function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
function getToken() { return localStorage.getItem("bkb-token") || ""; }

/* ——— PIN Screen —————————————————————————————————————————————————————— */
function PinScreen({ onAuth }: { onAuth: () => void }) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async () => {
    if (!pin.trim()) return;
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) });
      if (!r.ok) throw new Error();
      const d = await r.json();
      localStorage.setItem("bkb-token", d.token);
      onAuth();
    } catch { setErr("Invalid PIN"); setPin(""); } finally { setBusy(false); }
  };
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <img src="https://www.brettkingbuilder.com/wp-content/uploads/2021/08/logowhite.png" alt="BKB" className="h-16 w-auto mb-6" />
      <h1 className="text-xl mb-1" style={{ color: "#CDA274", fontFamily: "Georgia, serif" }}>Client Hub</h1>
      <p className="text-sm mb-8" style={{ color: "#8a8078" }}>Enter your PIN to continue</p>
      <div className="w-full max-w-xs space-y-4">
        <input type="password" inputMode="numeric" value={pin} onChange={e => setPin(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} placeholder="••••" autoFocus maxLength={10}
          className="w-full px-4 py-4 rounded-lg text-center text-2xl tracking-widest outline-none"
          style={{ background: "#242424", border: "1px solid rgba(205,162,116,0.12)", color: "#e8e0d8" }} />
        {err && <p className="text-center text-sm" style={{ color: "#c45c4c" }}>{err}</p>}
        <button onClick={submit} disabled={!pin.trim() || busy} className="w-full py-4 rounded-lg font-semibold disabled:opacity-30" style={{ background: "#CDA274", color: "#1a1a1a" }}>
          {busy ? "Verifying..." : "Enter"}
        </button>
      </div>
    </div>
  );
}

/* ——— Contact Search ————————————————————————————————————————————————— */
function ContactSearch({ selected, onSelect }: { selected: Contact | null; onSelect: (c: Contact | null) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (val: string) => {
    if (val.length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      const r = await fetch("/api/contacts?q=" + encodeURIComponent(val), { headers: { Authorization: "Bearer " + getToken() } });
      const d = await r.json();
      setResults(d.contacts || []);
      setOpen(true);
    } catch { setResults([]); } finally { setLoading(false); }
  }, []);

  const debounce = (val: string) => { setQ(val); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => search(val), 300); };

  if (selected) {
    const initials = selected.name.split(" ").map(n => n[0]).join("").slice(0, 2);
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-lg" style={{ background: "#242424", border: "1px solid rgba(205,162,116,0.25)" }}>
        <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: "#CDA274", color: "#1a1a1a" }}>{initials}</div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate" style={{ color: "#e8e0d8" }}>{selected.name}</p>
          <p className="text-xs truncate" style={{ color: "#8a8078" }}>{selected.email || selected.phone || ""}</p>
        </div>
        <button onClick={() => onSelect(null)} className="text-xs px-3 py-1 rounded" style={{ color: "#CDA274", background: "rgba(205,162,116,0.1)" }}>Change</button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input value={q} onChange={e => debounce(e.target.value)} onFocus={() => results.length > 0 && setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 200)} placeholder="Search contacts..." autoComplete="off"
        className="w-full px-4 py-3 rounded-lg outline-none text-sm" style={{ background: "#242424", border: "1px solid rgba(205,162,116,0.12)", color: "#e8e0d8" }} />
      {loading && <div className="absolute right-3 top-3.5 w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: "#CDA274 transparent #CDA274 transparent" }} />}
      {open && results.length > 0 && (
        <div className="absolute z-50 w-full mt-1 rounded-lg overflow-hidden shadow-2xl" style={{ background: "#2a2a2a", border: "1px solid rgba(205,162,116,0.12)" }}>
          {results.map(c => (
            <button key={c.id} onClick={() => { onSelect(c); setQ(""); setOpen(false); }} className="w-full flex items-center gap-3 px-4 py-3 hover:brightness-125 text-left" style={{ borderBottom: "1px solid rgba(205,162,116,0.06)" }}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: "#CDA274", color: "#1a1a1a" }}>
                {c.name.split(" ").map(n => n[0]).join("").slice(0, 2)}
              </div>
              <div className="min-w-0"><p className="text-sm truncate" style={{ color: "#e8e0d8" }}>{c.name}</p><p className="text-xs truncate" style={{ color: "#8a8078" }}>{c.email || c.phone || ""}</p></div>
            </button>
          ))}
        </div>
      )}
      {!loading && q.length >= 2 && results.length === 0 && open && (
        <div className="absolute z-50 w-full mt-1 rounded-lg p-4 text-center text-sm" style={{ background: "#2a2a2a", border: "1px solid rgba(205,162,116,0.12)", color: "#8a8078" }}>No contacts found</div>
      )}
    </div>
  );
}

/* ——— Main App ———————————————————————————————————————————————————————— */
export default function Home() {
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState<Tab>("chat");
  const [error, setError] = useState("");

  // Notes
  const [contact, setContact] = useState<Contact | null>(null);
  const [meetingType, setMeetingType] = useState<MeetingType>("");
  const [meetingDate, setMeetingDate] = useState("");
  const [transcript, setTranscript] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedParts, setSavedParts] = useState(0);

  // Chat
  const [chatContact, setChatContact] = useState<Contact | null>(null);
  const [chatOpp, setChatOpp] = useState<Opportunity | null>(null);
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [oppsLoading, setOppsLoading] = useState(false);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const canUpload = contact && meetingType && transcript.trim();
  const resetNotes = () => { setContact(null); setMeetingType(""); setMeetingDate(""); setTranscript(""); setSaved(false); setSavedParts(0); };

  // Fetch opportunities when chat contact changes
  useEffect(() => {
    setChatOpp(null);
    setOpps([]);
    if (!chatContact) return;
    let cancelled = false;
    (async () => {
      setOppsLoading(true);
      try {
        const r = await fetch("/api/opportunities?contactId=" + chatContact.id, { headers: { Authorization: "Bearer " + getToken() } });
        if (!r.ok) throw new Error();
        const d = await r.json();
        if (!cancelled) {
          setOpps(d.opportunities || []);
          // Auto-select if only one
          if (d.opportunities && d.opportunities.length === 1) setChatOpp(d.opportunities[0]);
        }
      } catch { if (!cancelled) setOpps([]); } finally { if (!cancelled) setOppsLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [chatContact]);

  const resizeInput = (val: string) => {
    setInput(val);
    if (inputRef.current) { inputRef.current.style.height = "auto"; inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + "px"; }
  };

  /* Upload transcript */
  const upload = async () => {
    if (!contact || !transcript.trim() || !meetingType) return;
    setError(""); setSaving(true);
    try {
      const r = await fetch("/api/notes", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + getToken() },
        body: JSON.stringify({ contactId: contact.id, transcript: transcript.trim(), meetingType, meetingDate: meetingDate || null }) });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "Upload failed"); }
      const d = await r.json();
      setSavedParts(d.partsCreated || 1); setSaved(true);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Failed"); } finally { setSaving(false); }
  };

  useEffect(() => { if (authed) return; if (getToken()) setAuthed(true); }, [authed]);

  /* Send chat */
  const sendChat = async (text: string) => {
    if (!text.trim() || thinking) return;
    const userMsg: ChatMsg = { id: uid(), role: "user", content: text.trim(), ts: Date.now() };
    setMsgs(p => [...p, userMsg]); setInput(""); if (inputRef.current) inputRef.current.style.height = "auto";
    setThinking(true); setError("");
    try {
      const history = [...msgs, userMsg].map(m => ({ role: m.role, content: m.content }));
      const r = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + getToken() },
        body: JSON.stringify({
          messages: history,
          contactId: chatContact?.id,
          contactName: chatContact?.name,
          opportunityId: chatOpp?.id,
          opportunityName: chatOpp?.name,
          jtJobId: chatOpp?.jtJobId,
          pipelineStage: chatOpp?.stageName,
        }) });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "Chat failed"); }
      const d = await r.json();
      setMsgs(p => [...p, { id: uid(), role: "assistant", content: d.reply, ts: Date.now(), agent: d.agent }]);
    } catch (e: unknown) {
      setMsgs(p => [...p, { id: uid(), role: "assistant", content: "Sorry, something went wrong. " + (e instanceof Error ? e.message : ""), ts: Date.now() }]);
    } finally { setThinking(false); }
  };

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, thinking]);

  if (!authed) return <PinScreen onAuth={() => setAuthed(true)} />;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#1a1a1a" }}>

      {/* Header */}
      <header className="sticky top-0 z-40 px-4 py-3" style={{ background: "rgba(26,26,26,0.92)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(205,162,116,0.12)" }}>
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <img src="https://www.brettkingbuilder.com/wp-content/uploads/2021/08/logowhite.png" alt="BKB" className="h-8 w-auto" />
          <div className="flex items-center gap-3">
            {chatContact && tab === "chat" && (
              <span className="text-xs px-2 py-1 rounded" style={{ color: "#8a8078", background: "rgba(205,162,116,0.06)" }}>{chatContact.name.split(" ")[0]}</span>
            )}
            <span className="text-xs" style={{ color: "#CDA274", fontFamily: "Georgia, serif", fontStyle: "italic" }}>Client Hub</span>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="max-w-2xl mx-auto w-full px-4 pt-4">
        <div className="flex gap-1 p-1 rounded-lg" style={{ background: "#242424" }}>
          {(["notes", "chat"] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)} className="flex-1 py-3 text-sm font-medium rounded-lg transition-all"
              style={{ background: tab === t ? "#CDA274" : "transparent", color: tab === t ? "#1a1a1a" : "#8a8078", fontWeight: tab === t ? 600 : 400 }}>
              {t === "notes" ? "Meeting Notes" : "Assistant"}
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="max-w-2xl mx-auto w-full px-4 mt-4">
          <div className="p-3 rounded-lg flex items-center gap-2 text-sm" style={{ background: "rgba(196,92,76,0.1)", border: "1px solid rgba(196,92,76,0.3)", color: "#c45c4c" }}>
            <span className="flex-1">{error}</span>
            <button onClick={() => setError("")} className="opacity-60 hover:opacity-100">&times;</button>
          </div>
        </div>
      )}

      {/* ——— NOTES TAB ——— */}
      {tab === "notes" && (
        <main className="max-w-2xl mx-auto w-full p-4 pb-20 space-y-5 animate-fade-in">
          {!saved ? (
            <>
              <section>
                <label className="block text-xs uppercase tracking-wider mb-2" style={{ color: "#CDA274" }}>Select Client</label>
                <ContactSearch selected={contact} onSelect={setContact} />
              </section>
              <section>
                <label className="block text-xs uppercase tracking-wider mb-2" style={{ color: "#CDA274" }}>Meeting Type</label>
                <select value={meetingType} onChange={e => setMeetingType(e.target.value as MeetingType)}
                  className="w-full px-4 py-3 rounded-lg outline-none appearance-none text-sm"
                  style={{ background: "#242424", border: "1px solid rgba(205,162,116,0.12)", color: meetingType ? "#e8e0d8" : "#8a8078" }}>
                  <option value="" disabled>Select meeting type...</option>
                  <option value="Client Meeting">Client Meeting</option>
                  <option value="Internal">Internal</option>
                  <option value="Trade">Trade</option>
                  <option value="Other">Other</option>
                </select>
              </section>
              <section>
                <label className="block text-xs uppercase tracking-wider mb-2" style={{ color: "#CDA274" }}>
                  Meeting Date <span className="normal-case italic" style={{ color: "#8a8078" }}>(optional)</span>
                </label>
                <input type="date" value={meetingDate} onChange={e => setMeetingDate(e.target.value)}
                  className="w-full px-4 py-3 rounded-lg outline-none text-sm"
                  style={{ background: "#242424", border: "1px solid rgba(205,162,116,0.12)", color: meetingDate ? "#e8e0d8" : "#8a8078", colorScheme: "dark" }} />
              </section>
              <section>
                <label className="block text-xs uppercase tracking-wider mb-2" style={{ color: "#CDA274" }}>Paste Transcript</label>
                <textarea value={transcript} onChange={e => setTranscript(e.target.value)} placeholder="Paste your meeting transcript here..." rows={10} disabled={!contact}
                  className="w-full px-4 py-3 rounded-lg outline-none text-sm leading-relaxed disabled:opacity-30"
                  style={{ background: "#242424", border: "1px solid rgba(205,162,116,0.12)", color: "#e8e0d8" }} />
                {transcript && (
                  <div className="mt-1 flex justify-between text-xs" style={{ color: "#8a8078" }}>
                    <span>{transcript.trim().length.toLocaleString()} chars</span>
                    <span>{Math.ceil(transcript.trim().length / 4000)} note{Math.ceil(transcript.trim().length / 4000) > 1 ? "s" : ""}</span>
                  </div>
                )}
              </section>
              <button onClick={upload} disabled={!canUpload || saving} className="w-full py-4 rounded-lg font-semibold disabled:opacity-30" style={{ background: "#CDA274", color: "#1a1a1a" }}>
                {saving ? "Uploading..." : "Upload to GHL"}
              </button>
            </>
          ) : (
            <div className="text-center py-12 animate-fade-in">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-6" style={{ background: "#4a9" }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <h3 className="text-xl font-semibold mb-2">{savedParts > 1 ? savedParts + " Notes Saved" : "Note Saved"}</h3>
              <p className="text-sm mb-6" style={{ color: "#8a8078" }}>
                {meetingType} transcript added to <strong style={{ color: "#CDA274" }}>{contact?.name}</strong>
              </p>
              <button onClick={resetNotes} className="px-8 py-3 rounded-lg font-semibold" style={{ background: "#CDA274", color: "#1a1a1a" }}>Upload Another</button>
            </div>
          )}
        </main>
      )}

      {/* ——— CHAT TAB ——— */}
      {tab === "chat" && (
        <div className="flex-1 flex flex-col max-w-2xl mx-auto w-full">

          {/* Contact selector */}
          <div className="px-4 pt-4 pb-2">
            <label className="block text-xs uppercase tracking-wider mb-2" style={{ color: "#CDA274" }}>
              GHL Client <span className="normal-case italic" style={{ color: "#8a8078" }}>(optional for JobTread queries)</span>
            </label>
            <ContactSearch selected={chatContact} onSelect={setChatContact} />
          </div>

          {/* Opportunity selector */}
          {chatContact && (
            <div className="px-4 pb-2 animate-fade-in">
              <label className="block text-xs uppercase tracking-wider mb-2" style={{ color: "#CDA274" }}>
                Opportunity <span className="normal-case italic" style={{ color: "#8a8078" }}>(links to JobTread job)</span>
              </label>
              {oppsLoading ? (
                <div className="px-4 py-3 rounded-lg text-sm" style={{ background: "#242424", border: "1px solid rgba(205,162,116,0.12)", color: "#8a8078" }}>
                  Loading opportunities...
                </div>
              ) : opps.length === 0 ? (
                <div className="px-4 py-3 rounded-lg text-sm" style={{ background: "#242424", border: "1px solid rgba(205,162,116,0.12)", color: "#8a8078" }}>
                  No opportunities found for this contact
                </div>
              ) : (
                <select
                  value={chatOpp?.id || ""}
                  onChange={e => {
                    const o = opps.find(op => op.id === e.target.value);
                    setChatOpp(o || null);
                  }}
                  className="w-full px-4 py-3 rounded-lg outline-none appearance-none text-sm"
                  style={{ background: "#242424", border: "1px solid rgba(205,162,116,0.12)", color: chatOpp ? "#e8e0d8" : "#8a8078" }}>
                  <option value="">Select opportunity...</option>
                  {opps.map(o => (
                    <option key={o.id} value={o.id}>
                      {o.name} — {o.stageName}{o.monetaryValue ? " ($" + Number(o.monetaryValue).toLocaleString() + ")" : ""}
                    </option>
                  ))}
                </select>
              )}
              {chatOpp && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="text-xs px-2 py-1 rounded" style={{ background: "rgba(205,162,116,0.1)", color: "#CDA274" }}>
                    {chatOpp.stageName}
                  </span>
                  {chatOpp.jtJobId && (
                    <span className="text-xs px-2 py-1 rounded" style={{ background: "rgba(74,153,153,0.1)", color: "#4a9999" }}>
                      JT Linked
                    </span>
                  )}
                  {chatOpp.monetaryValue > 0 && (
                    <span className="text-xs px-2 py-1 rounded" style={{ background: "rgba(205,162,116,0.06)", color: "#8a8078" }}>
                      ${Number(chatOpp.monetaryValue).toLocaleString()}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Messages area */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {msgs.length === 0 && (
              <div className="text-center py-8 animate-fade-in">
                <p className="text-lg mb-1" style={{ color: "#CDA274", fontFamily: "Georgia, serif" }}>How can I help?</p>
                <p className="text-sm mb-6" style={{ color: "#8a8078" }}>Ask about a client, project, or use a quick prompt below</p>
                <div className="grid grid-cols-2 gap-2">
                  {TEMPLATES.map(t => (
                    <button key={t.id} onClick={() => sendChat(t.prompt)} className="p-3 rounded-lg text-left text-sm transition-all hover:brightness-110"
                      style={{ background: "#242424", border: "1px solid rgba(205,162,116,0.12)", color: "#e8e0d8" }}>
                      <span className="mr-2">{t.icon}</span>{t.title}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {msgs.map(m => (
              <div key={m.id} className={"flex items-start gap-3 animate-slide-up " + (m.role === "user" ? "flex-row-reverse" : "")}>
                {m.role === "assistant" && (
                  <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: "#CDA274", color: "#1a1a1a" }}>BK</div>
                )}
                <div className="max-w-[85%]">
                  <div className={"px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap " + (m.role === "user" ? "rounded-2xl rounded-tr-md ml-auto" : "rounded-2xl rounded-tl-md")}
                    style={{ background: m.role === "user" ? "#CDA274" : "#242424", color: m.role === "user" ? "#1a1a1a" : "#e8e0d8", border: m.role === "user" ? "none" : "1px solid rgba(205,162,116,0.12)" }}>
                    {m.content}
                  </div>
                  {m.agent && m.role === "assistant" && (
                    <p className="text-right mt-1 text-xs italic" style={{ color: "#5a534c" }}>
                      via {m.agent}
                    </p>
                  )}
                </div>
              </div>
            ))}

            {thinking && (
              <div className="flex items-start gap-3 animate-slide-up">
                <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: "#CDA274", color: "#1a1a1a" }}>BK</div>
                <div className="px-4 py-3 rounded-2xl rounded-tl-md" style={{ background: "#242424", border: "1px solid rgba(205,162,116,0.12)" }}>
                  <div className="flex gap-1.5 py-1">
                    <div className="w-2 h-2 rounded-full thinking-dot" style={{ background: "#CDA274" }} />
                    <div className="w-2 h-2 rounded-full thinking-dot" style={{ background: "#CDA274" }} />
                    <div className="w-2 h-2 rounded-full thinking-dot" style={{ background: "#CDA274" }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {/* Input */}
          <div className="sticky bottom-0 px-4 pb-4 pt-2" style={{ background: "rgba(26,26,26,0.95)", backdropFilter: "blur(8px)" }}>
            <div className="flex items-end gap-2 rounded-xl p-2" style={{ background: "#242424", border: "1px solid rgba(205,162,116,0.12)" }}>
              <textarea ref={inputRef} value={input} onChange={e => resizeInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(input); } }}
                placeholder="Ask about a client or project..." rows={1}
                className="flex-1 bg-transparent border-none outline-none text-sm resize-none py-2 px-2" style={{ color: "#e8e0d8", maxHeight: "120px" }} />
              <button onClick={() => sendChat(input)} disabled={!input.trim() || thinking}
                className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center disabled:opacity-30 transition-all"
                style={{ background: "#CDA274", color: "#1a1a1a" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
