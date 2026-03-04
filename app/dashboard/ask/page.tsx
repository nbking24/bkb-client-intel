// @ts-nocheck
'use client';

import { useState, useRef, useEffect } from 'react';
import { MessageSquare, Send, Loader2, Bot, User } from 'lucide-react';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  agent?: string;
}

export default function AskAgentPage() {
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || loading) return;

    const userMsg = query.trim();
    setQuery('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    try {
      // Build auth token
      const pin = process.env.NEXT_PUBLIC_APP_PIN || '';
      const token = btoa(pin + ':');

      // Build message history for context
      const allMessages = [...messages, { role: 'user', content: userMsg }].map(m => ({
        role: m.role,
        content: m.content,
      }));

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: allMessages,
          // No contactId/opportunityId needed — agent searches independently
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(errData.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: data.reply || 'No response generated.',
          agent: data.agent,
        },
      ]);
    } catch (err) {
      console.error('Chat error:', err);
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: 'Sorry, I ran into an error: ' + (err instanceof Error ? err.message : 'Unknown error') + '. Please try again.',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleSuggestion = (suggestion: string) => {
    setQuery(suggestion);
  };

  // Simple markdown-like formatting for agent responses
  const formatContent = (content: string) => {
    // Split by newlines and handle basic formatting
    return content.split('\n').map((line, i) => {
      // Bold text
      const formatted = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      // Bullet points
      if (line.trim().startsWith('- ') || line.trim().startsWith('• ')) {
        return <div key={i} className="ml-3" dangerouslySetInnerHTML={{ __html: '&bull; ' + formatted.replace(/^[\s]*[-•]\s*/, '') }} />;
      }
      // Numbered lists
      if (/^\d+\.\s/.test(line.trim())) {
        return <div key={i} className="ml-3" dangerouslySetInnerHTML={{ __html: formatted }} />;
      }
      // Empty lines
      if (!line.trim()) return <div key={i} className="h-2" />;
      return <div key={i} dangerouslySetInnerHTML={{ __html: formatted }} />;
    });
  };

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem-3rem)]">
      <div className="mb-4">
        <h1 className="text-2xl font-bold" style={{ fontFamily: 'Georgia, serif', color: '#C9A84C' }}>
          Ask Agent
        </h1>
        <p className="text-sm mt-1" style={{ color: '#8a8078' }}>
          Ask questions about your projects, execute tasks in JobTread, or look up client information.
        </p>
      </div>

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-1">
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
              I can search JobTread and GHL to answer questions, create tasks, manage schedules, and more.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg w-full">
              {[
                'What active jobs do we have?',
                'Show me all open tasks past due',
                'Create a task for the Smith project',
                'What\'s the schedule for job #1234?',
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => handleSuggestion(suggestion)}
                  className="text-left px-3 py-2 rounded-lg text-xs transition-colors hover:border-opacity-30"
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
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} gap-2`}
          >
            {msg.role === 'assistant' && (
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-1"
                style={{ background: 'rgba(201,168,76,0.15)' }}
              >
                <Bot size={14} style={{ color: '#C9A84C' }} />
              </div>
            )}
            <div className="flex flex-col max-w-[80%]">
              {msg.role === 'assistant' && msg.agent && (
                <span className="text-[10px] mb-1 px-1.5 py-0.5 rounded w-fit" style={{ color: '#C9A84C', background: 'rgba(201,168,76,0.08)' }}>
                  {msg.agent}
                </span>
              )}
              <div
                className="px-4 py-3 rounded-lg text-sm leading-relaxed"
                style={
                  msg.role === 'user'
                    ? { background: '#1B3A5C', color: '#e8e0d8' }
                    : { background: '#242424', color: '#e8e0d8', border: '1px solid rgba(205,162,116,0.08)' }
                }
              >
                {msg.role === 'assistant' ? formatContent(msg.content) : msg.content}
              </div>
            </div>
            {msg.role === 'user' && (
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-1"
                style={{ background: 'rgba(27,58,92,0.3)' }}
              >
                <User size={14} style={{ color: '#e8e0d8' }} />
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex justify-start gap-2">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(201,168,76,0.15)' }}
            >
              <Bot size={14} style={{ color: '#C9A84C' }} />
            </div>
            <div
              className="px-4 py-3 rounded-lg flex items-center gap-2"
              style={{ background: '#242424', border: '1px solid rgba(205,162,116,0.08)' }}
            >
              <Loader2 size={16} className="animate-spin" style={{ color: '#C9A84C' }} />
              <span className="text-xs" style={{ color: '#8a8078' }}>Searching your data...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask about any project, create tasks, or check schedules..."
          className="w-full pl-4 pr-12 py-3 rounded-lg text-sm outline-none"
          style={{
            background: '#242424',
            color: '#e8e0d8',
            border: '1px solid rgba(205,162,116,0.12)',
          }}
          disabled={loading}
        />
        <button
          type="submit"
          disabled={!query.trim() || loading}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg transition-colors"
          style={{
            color: query.trim() && !loading ? '#C9A84C' : '#8a8078',
            background: query.trim() && !loading ? 'rgba(201,168,76,0.1)' : 'transparent',
          }}
        >
          <Send size={18} />
        </button>
      </form>
    </div>
  );
}
