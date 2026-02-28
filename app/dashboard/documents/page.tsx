'use client';

import { FileText, Search, Filter } from 'lucide-react';

export default function DocumentsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ fontFamily: 'Georgia, serif', color: '#C9A84C' }}>
          Document Intelligence
        </h1>
        <p className="text-sm mt-1" style={{ color: '#8a8078' }}>
          Search across project documents. Ask questions about specs, contracts, and approved drawings.
        </p>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#8a8078' }} />
        <input
          type="text"
          placeholder="Search documents across all projects..."
          className="w-full pl-10 pr-4 py-3 rounded-lg text-sm outline-none"
          style={{
            background: '#242424',
            color: '#e8e0d8',
            border: '1px solid rgba(205,162,116,0.12)',
          }}
          disabled
        />
      </div>

      {/* Tier Filters */}
      <div className="flex gap-3">
        <button
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
          style={{ background: 'rgba(205,162,116,0.1)', color: '#C9A84C', border: '1px solid rgba(205,162,116,0.2)' }}
        >
          <Filter size={14} />
          Approved Docs (Tier 1)
        </button>
        <button
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm"
          style={{ background: '#242424', color: '#8a8078', border: '1px solid rgba(205,162,116,0.08)' }}
        >
          Job Files (Tier 2)
        </button>
      </div>

      {/* Coming Soon Card */}
      <div
        className="flex flex-col items-center justify-center py-20 rounded-lg"
        style={{ background: '#242424', border: '1px solid rgba(205,162,116,0.08)' }}
      >
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
          style={{ background: 'rgba(201,168,76,0.1)' }}
        >
          <FileText size={28} style={{ color: '#C9A84C' }} />
        </div>
        <h2 className="text-lg font-bold mb-2" style={{ color: '#C9A84C' }}>
          Document Intelligence — Phase 2
        </h2>
        <p className="text-sm max-w-md text-center" style={{ color: '#8a8078' }}>
          Two-tier document search powered by AI. Approved documents (contracts, change orders)
          get high-confidence indexing. Job files provide supplemental context.
        </p>
        <div className="mt-6 flex gap-4">
          <div className="text-center">
            <p className="text-2xl font-bold" style={{ color: '#C9A84C' }}>Tier 1</p>
            <p className="text-xs mt-1" style={{ color: '#8a8078' }}>Approved Docs</p>
            <p className="text-xs" style={{ color: '#8a8078' }}>Webhook sync</p>
          </div>
          <div className="w-px" style={{ background: 'rgba(205,162,116,0.12)' }} />
          <div className="text-center">
            <p className="text-2xl font-bold" style={{ color: '#8a8078' }}>Tier 2</p>
            <p className="text-xs mt-1" style={{ color: '#8a8078' }}>Job Files</p>
            <p className="text-xs" style={{ color: '#8a8078' }}>Nightly sync</p>
          </div>
        </div>
      </div>
    </div>
  );
}
