// @ts-nocheck
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, BookOpen, RefreshCw, ChevronRight } from 'lucide-react';

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('bkb-token') || '' : '';
}

interface Brief {
  id: string;
  brief_type: string;
  brief_date: string;
  title: string | null;
  summary: string | null;
  drafted_at: string | null;
  drafted_by_agent: string | null;
  highlights: any;
  sources: any;
}

export default function ResearchBriefsPage() {
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    try {
      const r = await fetch('/api/marketing/research-briefs?limit=50', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      if (data.error) setError(data.error);
      else setBriefs(data.briefs || []);
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  if (loading && briefs.length === 0) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading briefs...
      </div>
    );
  }
  if (error) return <div className="rounded-md bg-red-50 p-4 text-red-700 text-sm">Failed: {error}</div>;

  const byType: Record<string, Brief[]> = {};
  for (const b of briefs) {
    byType[b.brief_type] = byType[b.brief_type] || [];
    byType[b.brief_type].push(b);
  }

  const typeOrder = ['weekly_trends', 'seasonal_ideas', 'aspirational_firms', 'foundation_study', 'other'];

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-blue-700" />
            Research Briefs
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Weekly trend briefs, seasonal idea banks, and aspirational-firm watch notes from the Cowork Content Researcher.
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {briefs.length === 0 && (
        <div className="bg-white border border-dashed border-gray-300 rounded-lg p-8 text-center">
          <BookOpen className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-600">
            No research briefs yet. The Content Researcher publishes weekly + seasonal briefs from Cowork.
          </p>
        </div>
      )}

      {typeOrder.map((t) => byType[t] && (
        <Section key={t} title={prettyType(t)} count={byType[t].length}>
          {byType[t].map((b) => <BriefRow key={b.id} brief={b} />)}
        </Section>
      ))}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">{title}</h3>
        <span className="inline-flex items-center justify-center min-w-[24px] h-5 text-xs rounded-full border px-1.5 bg-blue-50 text-blue-800 border-blue-200">
          {count}
        </span>
      </div>
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-100">
        {children}
      </div>
    </div>
  );
}

function BriefRow({ brief }: { brief: Brief }) {
  return (
    <Link href={`/dashboard/marketing/research-briefs/${brief.id}`} className="block px-4 py-3 hover:bg-gray-50">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-gray-900 text-sm truncate">
            {brief.title || 'Untitled brief'}
          </div>
          {brief.summary && (
            <div className="text-xs text-gray-600 mt-0.5 line-clamp-2">{brief.summary}</div>
          )}
          <div className="text-xs text-gray-400 mt-1">
            {new Date(brief.brief_date + 'T00:00:00').toLocaleDateString()}
            {brief.drafted_by_agent ? ` · ${brief.drafted_by_agent}` : ''}
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-gray-400 shrink-0 mt-1" />
      </div>
    </Link>
  );
}

function prettyType(t: string) {
  return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
