// @ts-nocheck
/**
 * SelectionsSheetView — the branded, client-facing selections sheet.
 *
 * Pure presentational component shared by:
 *   - /dashboard/selections-sheet (internal preview + print)
 *   - /s/[token]                  (public client link)
 *
 * Renders ONLY the client-safe data returned by the selections-sheet
 * API (no internal notes, no costs). Print styles are included so the
 * browser's Print → Save as PDF produces the deliverable.
 */

const BKB_LOGO =
  'https://www.brettkingbuilder.com/wp-content/uploads/2021/08/logowhite.png';

const BUCKET_STYLE = {
  client: { pill: '#8a6d1f', pillBg: '#fff4d6', accent: '#c9a542' },
  upcoming: { pill: '#4b4b4b', pillBg: '#eeebe6', accent: '#b6ad9f' },
  internal: { pill: '#3f5468', pillBg: '#e7edf3', accent: '#8fa3b5' },
  ordering: { pill: '#2f5d3a', pillBg: '#e4f0e6', accent: '#7fa98a' },
  done: { pill: '#6b6b6b', pillBg: '#ececec', accent: '#c2c2c2' },
};

const STATUS_LABEL = {
  '0. Not Started': 'Coming Up',
  '1. Client Selection Needed': 'Your Decision',
  '2. Internal Selection Needed': 'With Our Team',
  '3. Pricing Pending': 'Pricing in Progress',
  '4. Selected/Needs Order': 'Selected',
  '5. Ordered/Finalized': 'Finalized',
};

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

export default function SelectionsSheetView({ sheet }) {
  if (!sheet) return null;
  const { job, buckets } = sheet;

  return (
    <div
      className="sheet-root"
      style={{
        maxWidth: 820,
        margin: '0 auto',
        background: '#ffffff',
        color: '#1a1a1a',
        fontFamily:
          "Georgia, 'Times New Roman', serif",
      }}
    >
      <style>{`
        .sheet-root { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .sheet-line { break-inside: avoid; page-break-inside: avoid; }
        .sheet-bucket-head { break-after: avoid; page-break-after: avoid; }
        @media print {
          body { background: #ffffff !important; }
          .no-print { display: none !important; }
          .sheet-root { max-width: none !important; }
        }
      `}</style>

      {/* Header band */}
      <div
        style={{
          background: '#1a1a1a',
          color: '#ffffff',
          padding: '28px 36px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 24,
        }}
      >
        <img
          src={BKB_LOGO}
          alt="Brett King Builder-Contractor Inc."
          style={{ height: 64, width: 'auto' }}
        />
        <div style={{ textAlign: 'right' }}>
          <div
            style={{
              fontSize: 26,
              letterSpacing: 1,
              fontWeight: 700,
            }}
          >
            Selections
          </div>
          <div style={{ fontSize: 13, color: '#f1d89a', marginTop: 2 }}>
            {job.client}
          </div>
          <div style={{ fontSize: 12, color: '#cfcac2' }}>{job.address}</div>
          <div style={{ fontSize: 12, color: '#cfcac2' }}>
            {job.name}
            {job.number ? ' · #' + job.number : ''}
          </div>
        </div>
      </div>

      {/* Intro strip */}
      <div
        style={{
          padding: '18px 36px',
          background: '#faf7f2',
          borderBottom: '1px solid #e8e0d0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div style={{ fontSize: 13, color: '#4b4b4b' }}>
          {sheet.clientActionCount > 0 ? (
            <span>
              <strong>{sheet.clientActionCount}</strong>{' '}
              {sheet.clientActionCount === 1 ? 'selection is' : 'selections are'}{' '}
              waiting on your decision.
            </span>
          ) : (
            <span>No selections are waiting on you right now.</span>
          )}{' '}
          <span style={{ color: '#8a8078' }}>
            {sheet.openCount} open of {sheet.totalCount} total.
          </span>
        </div>
        <div style={{ fontSize: 12, color: '#8a8078' }}>
          Prepared {fmtDate(sheet.generatedAt)}
        </div>
      </div>

      {/* Buckets */}
      <div style={{ padding: '10px 36px 40px' }}>
        {buckets.map((bucket) => {
          const bs = BUCKET_STYLE[bucket.key] || BUCKET_STYLE.upcoming;
          return (
            <div key={bucket.key} style={{ marginTop: 30 }}>
              <div className="sheet-bucket-head">
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 10,
                    borderBottom: '2px solid ' + bs.accent,
                    paddingBottom: 6,
                  }}
                >
                  <span style={{ fontSize: 19, fontWeight: 700 }}>
                    {bucket.title}
                  </span>
                  <span style={{ fontSize: 13, color: '#8a8078' }}>
                    {bucket.count}
                  </span>
                </div>
                <div style={{ fontSize: 12.5, color: '#6b6b6b', marginTop: 5 }}>
                  {bucket.blurb}
                </div>
              </div>

              {bucket.trades.map((t, ti) => (
                <div key={ti} style={{ marginTop: 16 }}>
                  <div
                    style={{
                      fontSize: 11.5,
                      fontWeight: 700,
                      letterSpacing: 1.4,
                      textTransform: 'uppercase',
                      color: '#8a8078',
                      marginBottom: 6,
                    }}
                  >
                    {t.trade}
                  </div>
                  {t.lines.map((line) => (
                    <div
                      key={line.id}
                      className="sheet-line"
                      style={{
                        borderLeft: '3px solid ' + bs.accent,
                        background: '#fdfcf9',
                        border: '1px solid #ece7de',
                        borderLeftWidth: 3,
                        borderLeftColor: bs.accent,
                        borderRadius: 4,
                        padding: '12px 16px',
                        marginBottom: 10,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'baseline',
                          gap: 12,
                          flexWrap: 'wrap',
                        }}
                      >
                        <div style={{ fontSize: 15, fontWeight: 700 }}>
                          {line.name}
                          {line.area ? (
                            <span
                              style={{
                                fontWeight: 400,
                                fontSize: 12,
                                color: '#8a8078',
                                marginLeft: 8,
                              }}
                            >
                              {line.area}
                            </span>
                          ) : null}
                        </div>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: bs.pill,
                            background: bs.pillBg,
                            borderRadius: 999,
                            padding: '3px 10px',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {STATUS_LABEL[line.status] || line.status || '—'}
                        </span>
                      </div>
                      {line.description ? (
                        <div
                          style={{
                            fontSize: 13,
                            lineHeight: 1.55,
                            color: '#333333',
                            marginTop: 8,
                            whiteSpace: 'pre-line',
                          }}
                        >
                          {line.description}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          );
        })}

        {buckets.length === 0 && (
          <div
            style={{
              padding: '60px 0',
              textAlign: 'center',
              color: '#8a8078',
              fontSize: 14,
            }}
          >
            No selections have been set up for this project yet.
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            marginTop: 44,
            paddingTop: 14,
            borderTop: '1px solid #e8e0d0',
            display: 'flex',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
            fontSize: 11.5,
            color: '#8a8078',
          }}
        >
          <div>
            Brett King Builder-Contractor Inc. · Perkasie, PA ·
            brettkingbuilder.com
          </div>
          <div>
            Questions on any selection? Reach out to Nathan any time.
          </div>
        </div>
      </div>
    </div>
  );
}
