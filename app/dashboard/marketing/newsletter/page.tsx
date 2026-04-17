// @ts-nocheck
'use client';

import { Mail, Construction } from 'lucide-react';

export default function NewsletterPage() {
  return (
    <div className="max-w-3xl">
      <div className="bg-white border border-dashed border-gray-300 rounded-lg p-8 text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-blue-50 mb-4">
          <Mail className="w-7 h-7 text-blue-700" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          Newsletter Engine — Phase 2
        </h2>
        <p className="text-gray-600 text-sm mb-4 max-w-xl mx-auto">
          Monthly three-segment newsletter (past clients / nurture leads / referral partners).
          Curator and Editor agents draft; Nathan reviews all three variants in this tab and
          approves in one click.
        </p>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-amber-50 text-amber-800 text-xs rounded-full">
          <Construction className="w-3.5 h-3.5" />
          Scheduled for weeks 3–5. Data model already scaffolded.
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        <InfoCard
          title="Past Clients"
          subtitle="Segment 1"
          body="'What's new at BKB' framing. Featured project, testimonial, seasonal tip, soft referral CTA."
        />
        <InfoCard
          title="Nurture Leads"
          subtitle="Segment 2"
          body="'See what's possible' framing. Aspirational content, design education, re-engagement CTA."
        />
        <InfoCard
          title="Referral Partners"
          subtitle="Segment 3"
          body="Architects, designers, realtors. Portfolio drops, partnership wins, industry insight."
        />
      </div>
    </div>
  );
}

function InfoCard({ title, subtitle, body }: any) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">{subtitle}</div>
      <div className="font-semibold text-gray-900 mb-2">{title}</div>
      <div className="text-sm text-gray-600">{body}</div>
    </div>
  );
}
