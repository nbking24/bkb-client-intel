// @ts-nocheck
'use client';

import { MessageCircle, Construction, Shield } from 'lucide-react';

export default function FacebookPage() {
  return (
    <div className="max-w-3xl">
      <div className="bg-white border border-dashed border-gray-300 rounded-lg p-8 text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-blue-50 mb-4">
          <MessageCircle className="w-7 h-7 text-blue-700" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          Facebook Scout — Phase 3
        </h2>
        <p className="text-gray-600 text-sm mb-4 max-w-xl mx-auto">
          Local Facebook group monitoring with draft-mode replies. The Scout Agent surfaces
          relevant posts in this tab with a proposed reply; you approve, edit, or skip each
          one. Never auto-posts in draft mode.
        </p>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-amber-50 text-amber-800 text-xs rounded-full">
          <Construction className="w-3.5 h-3.5" />
          Scheduled for weeks 6–7. Data model already scaffolded.
        </div>
      </div>

      <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-5">
        <div className="flex items-start gap-3">
          <Shield className="w-5 h-5 text-blue-700 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-gray-900 mb-1">Guardrails from day one</h3>
            <ul className="text-sm text-gray-700 space-y-1">
              <li>• Draft-mode only for first 60 days — every reply needs approval</li>
              <li>• Hard-coded never-reply topics: politics, religion, minors, contractor-venting</li>
              <li>• Rate limits per group and per user to avoid looking like spam</li>
              <li>• Voice-drift monitor flags drafts that diverge from approved history</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
