/**
 * Structured content of a Marketing Project Profile. Stored in
 * marketing_photo_doc_state.content.profile and rendered to .docx each run.
 *
 * Style note: no em or en dashes in this file.
 */

/** Where a photo's bytes come from when the .docx is rendered. */
export type ImageRef =
  | { source: 'storage'; path: string } // taken from the original profile, kept in the marketing-profiles bucket
  | { source: 'jobtread'; fileId: string }; // a JobTread file, fetched as a resized JPEG

export type ProfilePhoto = { image: ImageRef; caption: string };

export type ProfileSection =
  | { kind: 'paragraphs'; heading: string; paragraphs: string[] }
  | { kind: 'scope'; heading: string; groups: { heading: string; bullets: string[] }[] }
  | { kind: 'challenges'; heading: string; pairs: { challenge: string; solution: string }[] }
  | { kind: 'leadBullets'; heading: string; intro?: string; items: { lead: string; text: string }[] }
  | { kind: 'bullets'; heading: string; intro?: string; bullets: string[] }
  | { kind: 'photos'; heading: string; intro: string; photos: ProfilePhoto[] };

export type ProfileContent = {
  title: string;
  subtitle: string; // "Marketing Project Profile"
  tagline: string;
  whatsNew: { date: string; text: string }[]; // newest first, date YYYY-MM-DD
  facts: { label: string; value: string }[];
  sections: ProfileSection[];
  /** Look of the original document, so the rebuild matches it. */
  style: { font: string; bodySizePt: number; headingSizePt: number };
};

export const SECTION_ORDER = [
  'Project Description',
  'Scope of Work',
  'How the Project Evolved',
  'Challenges & Solutions',
  'Suggested Marketing Angles',
  'Plans & Renderings',
  'Video Walk-Throughs',
];

export const FACT_LABELS = ['Project', 'Last Updated', 'Location', 'Project Type', 'Status', 'Standout Feature'];
