// Project Questionnaire: shared question config for the public page (/start)
// and the server (labels in the JobTread daily log).
// Style rule: no em or en dashes anywhere in client-facing text.

export type QType = 'text' | 'pick' | 'multi';

export interface Question {
  id: string;
  label: string;
  help?: string;
  type: QType;
  options?: string[];
  other?: boolean;            // adds "Something else" with a short box
  followUp?: { id: string; label: string };   // optional short box under picks
  required?: boolean;
  twoBox?: { id: string; label: string }[];   // two text boxes on one screen
}

export const PROJECT_TYPES = [
  { id: 'kitchen', label: 'Kitchen' },
  { id: 'bathroom', label: 'Bathroom' },
  { id: 'addition', label: 'Addition' },
  { id: 'whole_home', label: 'Whole home renovation' },
  { id: 'historic', label: 'Historic restoration' },
  { id: 'exterior', label: 'Exterior (porch, deck, siding, windows)' },
  { id: 'basement', label: 'Basement' },
  { id: 'other', label: 'Something else' },
];

export const PORTFOLIO: Record<string, { label: string; url: string }> = {
  kitchen: { label: 'Kitchens', url: 'https://www.brettkingbuilder.com/project-category/kitchens/' },
  bathroom: { label: 'Bathrooms', url: 'https://www.brettkingbuilder.com/project-category/bathrooms/' },
  addition: { label: 'Additions', url: 'https://www.brettkingbuilder.com/project-category/additions/' },
  whole_home: { label: 'Interiors', url: 'https://www.brettkingbuilder.com/project-category/interiors/' },
  historic: { label: 'Historic renovations', url: 'https://www.brettkingbuilder.com/project-category/historic-renovations/' },
  exterior: { label: 'Exteriors', url: 'https://www.brettkingbuilder.com/project-category/exteriors/' },
  basement: { label: 'Basements', url: 'https://www.brettkingbuilder.com/project-category/basements/' },
  other: { label: 'All projects', url: 'https://www.brettkingbuilder.com/projects-03-9/' },
};

export const INVESTMENT_LINK = 'https://www.brettkingbuilder.com/understanding-your-remodeling-investment/';

export const CORE_BEFORE: Question[] = [
  { id: 'not_working', type: 'text', required: true, label: "What isn't working about your home today?", help: 'What bothers you, and how long has it been that way?' },
  { id: 'why_now', type: 'text', label: 'What made now the right time to do something about it?', help: "A new chapter, a problem that's getting worse, finally having the time. Whatever it is." },
  { id: 'tried', type: 'multi', label: 'What have you already tried or looked into?', options: ['Talked with other contractors', 'Worked with an architect or designer', 'Did some of the work ourselves', 'Just getting started'], followUp: { id: 'tried_differently', label: "Anything you'd want to do differently this time?" } },
  { id: 'must_nice', type: 'text', label: 'What has to be part of this project for it to be worth doing? And what would you love to include if it fits?', help: "It's fine to list a lot under nice-to-haves.", twoBox: [{ id: 'must_haves', label: 'Must-haves' }, { id: 'nice_to_haves', label: 'Nice-to-haves' }] },
];

export const TYPE_QUESTIONS: Record<string, Question> = {
  kitchen: { id: 'type_kitchen', type: 'multi', other: true, label: 'What frustrates you most about your kitchen?', options: ['Not enough counter space', 'Not enough storage', 'Hard for two people to cook', 'Closed off from the rest of the house', 'Poor lighting', 'Dated look and finishes'] },
  bathroom: { id: 'type_bathroom', type: 'multi', other: true, label: 'What bothers you most about the bathroom?', options: ['Feels cramped', 'Not enough storage', 'Shower or tub is hard to use', 'Water damage or ventilation problems', 'Dated look', 'We want it to work as we get older'] },
  addition: { id: 'type_addition', type: 'multi', other: true, label: "What can't your home do today that you need it to?", options: ['Not enough bedrooms', 'No room for guests or family', 'No home office', 'Kitchen or living space too small', 'No first-floor bedroom', 'Need a mudroom or more storage'] },
  whole_home: { id: 'type_whole_home', type: 'text', label: 'Which rooms are causing the most trouble, and why?' },
  historic: { id: 'type_historic', type: 'multi', other: true, label: 'What worries you most about the house?', options: ['Water or moisture', 'Settling or structural concerns', 'Original features wearing out', 'Old wiring, plumbing or heating', "Past repairs that weren't done well", 'Keeping it true to its history'] },
  exterior: { id: 'type_exterior', type: 'multi', other: true, label: "What's the main problem outside?", options: ['Rot or wear', "Porch or deck isn't usable", 'Water getting in', "Doesn't look the way it should", 'Not enough outdoor living space'] },
  basement: { id: 'type_basement', type: 'multi', other: true, label: "What would you like the basement to do that it can't today?", options: ['Living or family space', 'Guest suite', 'Home gym', 'Office', 'Storage', 'Fix water or moisture first'] },
  other: { id: 'type_other', type: 'text', label: 'Tell us a little more about it.' },
};

export const CORE_AFTER: Question[] = [
  { id: 'decision_makers', type: 'text', label: 'Who else will be part of the decisions on this project?', help: "We'd like everyone who is part of the decision to be at our first meeting, so nothing gets lost in translation." },
  { id: 'investment', type: 'pick', label: 'What investment range are you considering?', help: 'A rough range helps us suggest options that fit.', options: ['Under $100,000', '$100,000 to $250,000', '$250,000 to $500,000', '$500,000 to $1,000,000', 'Over $1,000,000', 'Not sure yet'] },
  { id: 'timing', type: 'pick', label: 'When are you hoping to start?', options: ['As soon as possible', 'In the next 3 to 6 months', '6 to 12 months from now', 'More than a year out', 'Not sure yet'], followUp: { id: 'done_by', label: 'Is there a date it needs to be done by?' } },
];

export const LAST_TEXT: Question = { id: 'anything_else', type: 'text', label: 'Anything else we should know about the house or the project?', help: "Age of the home, past problems like water or settling, or anything you've already ruled out." };

/** Type questions shown for the picked types: whole home replaces kitchen and bathroom; max 3. */
export function typeQuestionsFor(types: string[]): Question[] {
  let t = [...types];
  if (t.includes('whole_home')) t = t.filter((x) => x !== 'kitchen' && x !== 'bathroom');
  return t.slice(0, 3).map((x) => TYPE_QUESTIONS[x]).filter(Boolean);
}

/** Every label by answer id, for writing the daily log. */
export function labelMap(): Record<string, string> {
  const m: Record<string, string> = {};
  const add = (q: Question) => {
    m[q.id] = q.label;
    if (q.followUp) m[q.followUp.id] = q.followUp.label;
    if (q.twoBox) q.twoBox.forEach((b) => (m[b.id] = b.label));
    if (q.other) m[q.id + '_other'] = 'Something else';
  };
  [...CORE_BEFORE, ...Object.values(TYPE_QUESTIONS), ...CORE_AFTER, LAST_TEXT].forEach(add);
  return m;
}

export const ANSWER_ORDER = [
  'not_working', 'why_now', 'tried', 'tried_differently', 'must_haves', 'nice_to_haves',
  'type_kitchen', 'type_kitchen_other', 'type_bathroom', 'type_bathroom_other', 'type_addition', 'type_addition_other',
  'type_whole_home', 'type_historic', 'type_historic_other', 'type_exterior', 'type_exterior_other',
  'type_basement', 'type_basement_other', 'type_other',
  'decision_makers', 'investment', 'timing', 'done_by', 'anything_else',
];
