// @ts-nocheck
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, BookOpen, ArrowLeft, ExternalLink } from 'lucide-react';

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('bkb-token') || '' : '';
}

export default function BriefDetailPage() {
  const params = useParams() as { id: string };
  const [brief, setBrief] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    fetch(`/api/marketing/research-briefs/${params.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d) => { if (d.error) setError(d.error); else setBrief(d.brief); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [params.id]);

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-500"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...</div>;
  if (error) return <div className="rounded-md bg-red-50 p-4 text-red-700 text-sm">{error}</div>;
  if (!brief) return <div className="text-gray-500">Brief not found.</div>;

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <Link href="/dashboard/marketing/research-briefs" className="text-sm text-blue-700 hover:underline flex items-center gap-1 mb-2">
          <ArrowLeft className="w-3.5 h-3.5" /> All briefs
        </Link>
        <div className="flex items-start gap-3">
          <BookOpen className="w-6 h-6 text-blue-700 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <h2 className="text-2xl font-semibold text-gray-900">{brief.title || 'Untitled brief'}</h2>
            <div className="text-sm text-gray-500 mt-1">
              <span className="capitalize">{(brief.brief_type || '').replace(/_/g,' ')}</span>
              {' · '}
              {new Date(brief.brief_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              {brief.drafted_by_agent ? ` · ${brief.drafted_by_agent}` : ''}
            </div>
          </div>
        </div>
      </div>

      {brief.summary && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-gray-800">
          <span className="font-medium">Takeaway: </span>{brief.summary}
        </div>
      )}

      {Array.isArray(brief.highlights) && brief.highlights.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Highlights</h3>
          <ul className="space-y-3">
            {brief.highlights.map((h: any, i: number) => (
              <li key={i} className="text-sm">
                <div className="font-medium text-gray-900">{h.headline || h.title}</div>
                {h.why_it_matters && <div className="text-gray-600 mt-1">{h.why_it_matters}</div>}
                {h.source_url && (
                  <a href={h.source_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-700 hover:underline inline-flex items-center gap-1 mt-1">
                    source <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {brief.content_markdown && (
        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Full brief</h3>
          <pre className="text-sm text-gray-800 whitespace-pre-wrap font-sans leading-relaxed">{brief.content_markdown}</pre>
        </div>
      )}

      {Array.isArray(brief.sources) && brief.sources.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Sources</h3>
          <ul className="space-y-2 text-sm">
            {brief.sources.map((s: any, i: number) => (
              <li key={i}>
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline inline-flex items-center gap-1">
                    {s.name || s.url} <ExternalLink className="w-3 h-3" />
                  </a>
                ) : (
                  <span className="text-gray-700">{s.name}</span>
                )}
                {s.date && <span className="text-gray-400 text-xs ml-2">{s.date}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
