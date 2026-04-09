'use client';

import { useState, useRef, useEffect } from 'react';
import { MessageSquare, X, Send, Loader2, ChevronUp } from 'lucide-react';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('bkb-token') || '' : '';
}

export default function DashboardChat({ userId }: { userId: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  async function sendMessage() {
    if (!input.trim() || loading) return;

    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    try {
      const res = await fetch('/api/dashboard/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({
          userId,
          message: userMsg,
          history: messages.slice(-10),
        }),
      });

      if (!res.ok) throw new Error('Chat failed');
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
    } catch {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' },
      ]);
    } finally {
      setLoading(false);
    }
  }

  // Send a message directly (from suggestion chips)
  function sendDirect(text: string) {
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setLoading(true);
    fetch('/api/dashboard/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ userId, message: text, history: messages }),
    })
      .then(r => r.json())
      .then(data => setMessages(prev => [...prev, { role: 'assistant', content: data.reply || 'No response' }]))
      .catch(() => setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, something went wrong.' }]))
      .finally(() => setLoading(false));
  }

  // Collapsed button
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 md:bottom-6 md:right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-full shadow-lg transition-all hover:scale-105 active:scale-95"
        style={{ background: '#c88c00', color: '#ffffff' }}
      >
        <MessageSquare size={18} />
        <span className="text-sm font-semibold hidden md:inline">Ask Assistant</span>
      </button>
    );
  }

  // Open chat panel
  return (
    <div
      className="fixed bottom-0 right-0 md:bottom-4 md:right-4 z-50 flex flex-col w-full md:w-96 md:rounded-xl shadow-2xl overflow-hidden"
      style={{
        height: '100dvh',
        maxHeight: '100dvh',
        background: '#ffffff',
        border: '1px solid rgba(200,140,0,0.15)',
      }}
    >
      {/* Adjust height for md screens */}
      <style>{`@media (min-width: 768px) { .chat-panel { height: 520px !important; max-height: 80vh !important; } }`}</style>
      <div className="chat-panel flex flex-col" style={{ height: '100dvh', maxHeight: '100dvh' }}>
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 flex-shrink-0"
          style={{ background: '#f8f6f3', borderBottom: '1px solid rgba(200,140,0,0.12)' }}
        >
          <div className="flex items-center gap-2">
            <MessageSquare size={16} style={{ color: '#c88c00' }} />
            <span className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>Dashboard Assistant</span>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1.5 rounded-lg hover:bg-white/10 active:bg-white/20"
          >
            <X size={16} style={{ color: '#8a8078' }} />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ minHeight: 0 }}>
          {messages.length === 0 && (
            <div className="text-center py-8">
              <MessageSquare size={24} className="mx-auto mb-3" style={{ color: '#c88c00', opacity: 0.5 }} />
              <p className="text-sm" style={{ color: '#8a8078' }}>Ask me anything about your projects, emails, schedule, or tasks.</p>
              <div className="mt-4 space-y-2">
                {[
                  "What's the status of the Galtieri project?",
                  "Draft a reply to Brendan about the doors",
                  "What meetings do I have this week?",
                  "Which tasks are overdue?",
                ].map((suggestion, i) => (
                  <button
                    key={i}
                    onClick={() => sendDirect(suggestion)}
                    className="block w-full text-left text-xs px-3 py-2 rounded-lg hover:bg-white/[0.05] active:bg-white/[0.08]"
                    style={{ color: '#a09890', border: '1px solid rgba(200,140,0,0.08)' }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className="max-w-[85%] px-3 py-2 rounded-xl text-sm whitespace-pre-wrap"
                style={
                  msg.role === 'user'
                    ? { background: '#c88c00', color: '#ffffff' }
                    : { background: '#f8f6f3', color: '#1a1a1a', border: '1px solid rgba(200,140,0,0.08)' }
                }
              >
                {msg.content}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="px-3 py-2 rounded-xl" style={{ background: '#f8f6f3' }}>
                <Loader2 size={14} className="animate-spin" style={{ color: '#c88c00' }} />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div
          className="flex items-center gap-2 px-3 py-3 flex-shrink-0"
          style={{ background: '#f8f6f3', borderTop: '1px solid rgba(200,140,0,0.12)' }}
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendMessage()}
            placeholder="Ask about projects, emails, schedule..."
            className="flex-1 px-3 py-2.5 rounded-lg text-sm outline-none"
            style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.12)', color: '#1a1a1a' }}
            disabled={loading}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || loading}
            className="p-2.5 rounded-lg disabled:opacity-30 hover:bg-white/10 active:bg-white/20"
            style={{ color: '#c88c00' }}
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
