'use client';

import { useState } from 'react';
import { MessageSquare, Send, Loader2 } from 'lucide-react';

export default function AskAgentPage() {
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || loading) return;

    const userMsg = query.trim();
    setQuery('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    // TODO: Wire to Claude API with JobTread + document context
    setTimeout(() => {
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: 'Agent integration coming in Phase 3. I\'ll be able to search your JobTread data, approved documents, and project history to answer questions.',
        },
      ]);
      setLoading(false);
    }, 1200);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem-3rem)]">
      <div className="mb-4">
        <h1 className="text-2xl font-bold" style={{ fontFamily: 'Georgia, serif', color: '#C9A84C' }}>
          Ask Agent
        </h1>
        <p className="text-sm mt-1" style={{ color: '#8a8078' }}>
          Ask questions about your projects. The agent searches JobTread data and project documents.
        </p>
      </div>

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 mb-4">
        {messages.length === 0 && (
          <div
            className="flex flex-col items-center justify-center py-20 rounded-lg"
            style={{ background: '#242424', border: '1px solid rgba(205,162,116,0.08)' }}
          >
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
              style={{ background: 'rgba(201,168,76,0.1)' }}
            >
              <MessageSquare size={28} style={{ color: '#C9A84C' }} />
            </div>
            <h2 className="text-lg font-bold mb-2" style={{ color: '#C9A84C' }}>
              BKB Project Assistant
            </h2>
            <p className="text-sm max-w-md text-center mb-6" style={{ color: '#8a8078' }}>
              Ask anything about your projects, contracts, schedules, or documents.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg w-full">
              {[
                'What\'s the status of the Johnson project?',
                'Show me all open tasks past due',
                'What selections are pending from clients?',
                'Which projects are waiting on permits?',
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => setQuery(suggestion)}
                  className="text-left px-3 py-2 rounded-lg text-xs"
                  style={{
                    background: '#1a1a1a',
                    color: '#8a8078',
                    border: '1px solid rgba(205,162,116,0.08)',
                  }}
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
              className="max-w-[80%] px-4 py-3 rounded-lg text-sm"
              style={
                msg.role === 'user'
                  ? { background: '#1B3A5C', color: '#e8e0d8' }
                  : { background: '#242424', color: '#e8e0d8', border: '1px solid rgba(205,162,116,0.08)' }
              }
            >
              {msg.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div
              className="px-4 py-3 rounded-lg"
              style={{ background: '#242424', border: '1px solid rgba(205,162,116,0.08)' }}
            >
              <Loader2 size={18} className="animate-spin" style={{ color: '#C9A84C' }} />
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask about any project, document, or schedule..."
          className="w-full pl-4 pr-12 py-3 rounded-lg text-sm outline-none"
          style={{
            background: '#242424',
            color: '#e8e0d8',
            border: '1px solid rgba(205,162,116,0.12)',
          }}
        />
        <button
          type="submit"
          disabled={!query.trim() || loading}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg transition-colors"
          style={{
            color: query.trim() ? '#C9A84C' : '#8a8078',
            background: query.trim() ? 'rgba(201,168,76,0.1)' : 'transparent',
          }}
        >
          <Send size={18} />
        </button>
      </form>
    </div>
  );
}
