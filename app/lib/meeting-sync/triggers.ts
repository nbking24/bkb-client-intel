// @ts-nocheck
/**
 * Meeting sync: the trigger words Terri types at the front of a Google
 * Calendar title. The key is what the config's workflow_map points at a Loop
 * workflow. Matching ignores case, extra spaces and the separator (colon,
 * dash or nothing), so "discovery call - Smith" works the same as
 * "Discovery Call: Smith".
 *
 * Source of truth for the list: Terri's meeting SOP.
 */

export interface TriggerType {
  key: string;
  label: string;
  sales: boolean;
  phrases: string[]; // longest first within a type is not required; we sort globally
}

export const TRIGGERS: TriggerType[] = [
  { key: 'info_call', label: 'Informational Call', sales: true, phrases: ['informational call', 'information call', 'info call'] },
  { key: 'discovery_call', label: 'Discovery Call', sales: true, phrases: ['discovery call'] },
  { key: 'consultation', label: 'Initial Consultation Meeting', sales: true, phrases: ['initial consultation meeting', 'initial consultation'] },
  { key: 'design_agreement', label: 'Design Agreement Call', sales: true, phrases: ['design agreement call', 'design agreement review'] },
  { key: 'phone_call', label: 'Phone Call', sales: false, phrases: ['phone call'] },
  { key: 'in_person', label: 'In-Person Meeting', sales: false, phrases: ['in-person meeting', 'in person meeting'] },
  { key: 'virtual', label: 'Virtual Meeting', sales: false, phrases: ['virtual meeting'] },
];

const ALL = TRIGGERS.flatMap((t) => t.phrases.map((p) => ({ t, p }))).sort((a, b) => b.p.length - a.p.length);

export function parseTitle(title: string): { type: TriggerType | null; subject: string } {
  const raw = String(title || '').trim();
  const lower = raw.toLowerCase();
  for (const { t, p } of ALL) {
    if (lower.startsWith(p)) {
      const rest = raw.slice(p.length).replace(/^\s*[:\-–—|]?\s*/, '').trim();
      return { type: t, subject: rest };
    }
  }
  return { type: null, subject: raw };
}

export const triggerByKey = (k: string) => TRIGGERS.find((t) => t.key === k) || null;
