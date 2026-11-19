// @ts-nocheck
/**
 * Job Costing export: one job's costs and labor as an Excel workbook, built
 * in the browser from the detail data already on screen (so it matches the
 * page exactly, including the "Data as of" time).
 *
 * Tab 1 "Costs by Group": one row per cost code group with Budget, Actual
 *   (approved bills plus BKB labor), Pending (pending bills and open POs),
 *   Remaining and % Used. Under each group: a Subs subtotal and a Materials
 *   subtotal (and Other, when a line is neither) with every bill or PO under
 *   it, then a BKB labor row. Groups are collapsible: Excel's 1 / 2 / 3
 *   buttons at the left show groups only, groups with subtotals, or every
 *   bill. It opens at level 2.
 * Tab 2 "Labor Hours": per group, budgeted, actual and remaining work hours
 *   and % used, with the hours by employee under each group.
 *
 * Choices (Nathan, 2026-11-19): approved bills count as actual, pending
 * shown separately; collapsible groups; split Subs and Materials; labor
 * hours plus who worked.
 *
 * Style note: no em or en dashes in this file.
 */

const MONEY = '$#,##0.00;[Red]-$#,##0.00';
const HOURS = '#,##0.0;[Red]-#,##0.0';
const PCT = '0%';
const NAVY = 'FF1F3A5F';
const GROUP_FILL = 'FFEEF3F8';
const SUB_FILL = 'FFF7F7F5';

type Kind = 'Subs' | 'Materials' | 'Other';

/** Subs or Materials for a bill line: its cost type, else its name ("0803 - Materials"). */
export function lineKind(l: { costType?: string | null; itemName?: string | null }): Kind {
  const t = String(l.costType || '');
  if (/sub/i.test(t)) return 'Subs';
  if (/material/i.test(t)) return 'Materials';
  const n = String(l.itemName || '');
  if (/\b\d{2}02\b|\s-\s*sub\b/i.test(n)) return 'Subs';
  if (/\b\d{2}03\b|\s-\s*materials?\b/i.test(n)) return 'Materials';
  return 'Other';
}

function safeName(s: string) {
  return String(s || 'Job').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function exportJobCostingXlsx(detail: any) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'BKB Hub';
  wb.created = new Date();

  const job = detail.job || {};
  const asOf = detail.cachedAt ? new Date(detail.cachedAt) : new Date();
  const title = (job.name || 'Job') + (job.number ? ' (Job #' + job.number + ')' : '');
  const asOfText = 'Data as of ' + asOf.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

  // ---------------------------------------------------------------- Costs
  const ws = wb.addWorksheet('Costs by Group', {
    properties: { outlineProperties: { summaryBelow: false, summaryRight: false } },
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } },
    headerFooter: { oddFooter: '&L' + safeName(title) + '&RPage &P of &N' },
  });
  ws.columns = [
    { key: 'name', width: 44 },
    { key: 'vendor', width: 30 },
    { key: 'doc', width: 10 },
    { key: 'date', width: 12 },
    { key: 'budget', width: 15 },
    { key: 'actual', width: 15 },
    { key: 'pending', width: 15 },
    { key: 'remaining', width: 15 },
    { key: 'pct', width: 9 },
  ];
  ws.addRow([title]).font = { bold: true, size: 14, color: { argb: NAVY } };
  ws.addRow([(job.clientName ? job.clientName + '   ' : '') + asOfText]).font = { italic: true, color: { argb: 'FF555555' } };
  ws.addRow(['Actual = approved bills plus BKB labor. Pending = pending bills and open purchase orders. Remaining = Budget minus Actual minus Pending.']).font = { size: 9, color: { argb: 'FF777777' } };
  ws.addRow([]);
  const head = ws.addRow(['Group / Item', 'Vendor', 'Bill #', 'Date', 'Budget', 'Actual', 'Pending', 'Remaining', '% Used']);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }));
  const headRow = head.number;
  ws.views = [{ state: 'frozen', ySplit: headRow }];
  ws.pageSetup.printTitlesRow = headRow + ':' + headRow;

  const money = (row: any, cols: string[]) => cols.forEach((k) => (row.getCell(k).numFmt = MONEY));
  let gBudget = 0, gActual = 0, gPending = 0;

  for (const g of detail.costCodeBreakdown || []) {
    const budget = Number(g.estimatedCost) || 0;
    const actual = Number(g.actualCost) || 0;
    const pending = Number(g.pendingCost) || 0;
    if (!budget && !actual && !pending) continue;
    gBudget += budget; gActual += actual; gPending += pending;

    const gr = ws.addRow({
      name: (g.costCodeNumber ? g.costCodeNumber + ' ' : '') + (g.costCodeName || ''),
      budget, actual, pending,
      remaining: budget - actual - pending,
      pct: budget > 0 ? actual / budget : null,
    });
    gr.font = { bold: true };
    gr.eachCell({ includeEmpty: true }, (c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GROUP_FILL } }));
    money(gr, ['budget', 'actual', 'pending', 'remaining']);
    gr.getCell('pct').numFmt = PCT;

    // Bills and POs by Subs / Materials / Other, then BKB labor.
    const lines = [
      ...(g.actualLines || []).filter((l) => l.kind !== 'labor').map((l) => ({ ...l, status: 'actual' })),
      ...(g.pendingLines || []).filter((l) => l.kind !== 'labor').map((l) => ({ ...l, status: 'pending' })),
    ];
    for (const kind of ['Subs', 'Materials', 'Other'] as Kind[]) {
      const mine = lines.filter((l) => lineKind(l) === kind).sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
      if (!mine.length) continue;
      const a = mine.filter((l) => l.status === 'actual').reduce((s, l) => s + (Number(l.cost) || 0), 0);
      const p = mine.filter((l) => l.status === 'pending').reduce((s, l) => s + (Number(l.cost) || 0), 0);
      const sr = ws.addRow({ name: '   ' + kind + ' (' + mine.length + ')', actual: a || null, pending: p || null });
      sr.outlineLevel = 1;
      sr.font = { bold: true, color: { argb: 'FF333333' } };
      sr.eachCell({ includeEmpty: true }, (c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUB_FILL } }));
      money(sr, ['actual', 'pending']);
      for (const l of mine) {
        const br = ws.addRow({
          name: '        ' + (l.itemName || '') + (l.kind === 'po' ? ' (PO)' : '') + (l.status === 'pending' && l.kind !== 'po' ? ' (pending)' : ''),
          vendor: l.label || '',
          doc: l.docNumber || '',
          date: l.date ? new Date(l.date) : null,
          actual: l.status === 'actual' ? Number(l.cost) || 0 : null,
          pending: l.status === 'pending' ? Number(l.cost) || 0 : null,
        });
        br.outlineLevel = 2;
        br.hidden = true; // opens at level 2; the 3 button shows every bill
        br.getCell('date').numFmt = 'mm/dd/yyyy';
        money(br, ['actual', 'pending']);
      }
    }
    const labor = (g.actualLines || []).filter((l) => l.kind === 'labor');
    const laborCost = labor.reduce((s, l) => s + (Number(l.cost) || 0), 0);
    const laborHours = labor.reduce((s, l) => s + (Number(l.hours) || 0), 0);
    if (laborCost || laborHours) {
      const lr = ws.addRow({ name: '   BKB labor (' + Math.round(laborHours * 10) / 10 + ' hrs, see Labor Hours tab)', actual: laborCost || null });
      lr.outlineLevel = 1;
      lr.font = { bold: true, color: { argb: 'FF333333' } };
      lr.eachCell({ includeEmpty: true }, (c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUB_FILL } }));
      money(lr, ['actual']);
    }
  }
  ws.addRow([]);
  const tr = ws.addRow({ name: 'TOTAL', budget: gBudget, actual: gActual, pending: gPending, remaining: gBudget - gActual - gPending, pct: gBudget > 0 ? gActual / gBudget : null });
  tr.font = { bold: true };
  tr.border = { top: { style: 'thin' } };
  money(tr, ['budget', 'actual', 'pending', 'remaining']);
  tr.getCell('pct').numFmt = PCT;

  // ---------------------------------------------------------------- Labor
  const wl = wb.addWorksheet('Labor Hours', {
    properties: { outlineProperties: { summaryBelow: false, summaryRight: false } },
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } },
    headerFooter: { oddFooter: '&L' + safeName(title) + '&RPage &P of &N' },
  });
  wl.columns = [{ key: 'name', width: 40 }, { key: 'budget', width: 14 }, { key: 'actual', width: 14 }, { key: 'remaining', width: 14 }, { key: 'pct', width: 10 }];
  wl.addRow([title + ': Labor Hours']).font = { bold: true, size: 14, color: { argb: NAVY } };
  wl.addRow([asOfText]).font = { italic: true, color: { argb: 'FF555555' } };
  wl.addRow(['Work hours only (travel and break time are not counted). Budgeted hours come from labor lines on approved change orders.']).font = { size: 9, color: { argb: 'FF777777' } };
  wl.addRow([]);
  const lh = wl.addRow(['Group / Employee', 'Budgeted hrs', 'Actual hrs', 'Remaining hrs', '% Used']);
  lh.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  lh.eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }));
  wl.views = [{ state: 'frozen', ySplit: lh.number }];
  wl.pageSetup.printTitlesRow = lh.number + ':' + lh.number;

  const cats = (detail.laborHoursByCategory || []).slice().sort((a, b) => String(a.costCodeNumber).localeCompare(String(b.costCodeNumber)));
  let tB = 0, tA = 0;
  let missingEmployees = false;
  for (const c of cats) {
    const b = Number(c.budgetedHours) || 0;
    const a = Number(c.actualHours) || 0;
    if (!b && !a) continue;
    tB += b; tA += a;
    const r = wl.addRow({ name: (c.costCodeNumber ? c.costCodeNumber + ' ' : '') + (c.costCodeName || ''), budget: b, actual: a, remaining: b - a, pct: b > 0 ? a / b : null });
    r.font = { bold: true };
    r.eachCell({ includeEmpty: true }, (cell) => (cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GROUP_FILL } }));
    ['budget', 'actual', 'remaining'].forEach((k) => (r.getCell(k).numFmt = HOURS));
    r.getCell('pct').numFmt = PCT;
    if (!Array.isArray(c.employees)) missingEmployees = true;
    for (const e of c.employees || []) {
      const er = wl.addRow({ name: '   ' + e.name, actual: Number(e.hours) || 0 });
      er.outlineLevel = 1;
      er.getCell('actual').numFmt = HOURS;
    }
  }
  wl.addRow([]);
  const lt = wl.addRow({ name: 'TOTAL', budget: tB, actual: tA, remaining: tB - tA, pct: tB > 0 ? tA / tB : null });
  lt.font = { bold: true };
  lt.border = { top: { style: 'thin' } };
  ['budget', 'actual', 'remaining'].forEach((k) => (lt.getCell(k).numFmt = HOURS));
  lt.getCell('pct').numFmt = PCT;
  if (missingEmployees) {
    wl.addRow([]);
    wl.addRow(['Hours by employee need fresher data: click Refresh on the job, then export again.']).font = { italic: true, color: { argb: 'FF8A6100' } };
  }

  // ---------------------------------------------------------------- download
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = safeName(title) + ' Job Costing ' + asOf.toISOString().slice(0, 10) + '.xlsx';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
