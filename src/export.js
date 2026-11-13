/* Pure helpers for exporting notes to a single markdown file. No DOM or file access, so they can be unit-tested. */

import { parseArchiveName, sortArchives } from './archive.js';

export const CURRENT = 'current.md';

/** Export choices besides individual archived sprints. `months` limits archives by the date in their filename. */
export const RANGES = [
  { id: 'current', label: 'Current sprint', title: 'current sprint' },
  { id: 'months:6', label: 'Last 6 months', title: 'last 6 months', months: 6 },
  { id: 'months:12', label: 'Last year', title: 'last year', months: 12 },
  { id: 'all', label: 'Everything', title: 'everything' }
];

/**
 * The date `months` before `today`, clamped to the end of a shorter month (Aug 31 minus 6 months is Feb 28/29).
 * @param {string} today YYYY-MM-DD
 * @returns {string} YYYY-MM-DD
 */
export function monthsBefore(today, months) {
  const [y, m, d] = today.split('-').map(Number);
  const total = y * 12 + (m - 1) - months, year = Math.floor(total / 12), month = total % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

/**
 * Files to include for an export choice, oldest first, with the current sprint last.
 * @param {string} choice a RANGES id, or `archive/<name>` for one archived sprint
 * @param {string[]} archives archive filenames (without the `archive/` prefix)
 * @param {string} today YYYY-MM-DD
 */
export function pickFiles(choice, archives, today) {
  if (choice.startsWith('archive/')) return [choice];
  const range = RANGES.find(r => r.id === choice);
  if (!range) throw new Error(`Unknown export choice: ${choice}`);
  if (range.id === 'current') return [CURRENT];
  const since = range.months ? monthsBefore(today, range.months) : '';
  const picked = sortArchives(archives).filter(n => { const p = parseArchiveName(n); return !since || (p && p.date >= since); });
  return [...picked.map(n => 'archive/' + n), CURRENT];
}

export function exportTitle(choice, today) {
  if (choice.startsWith('archive/')) {
    const p = parseArchiveName(choice);
    if (!p) return `Sprint notes: ${choice.replace('archive/', '')}`;
    const custom = !/^sprint(-\d+)?$/.test(p.label);
    return `Sprint notes: sprint ended ${p.date}${custom ? ` (${p.label})` : p.n > 1 ? ` (#${p.n})` : ''}`;
  }
  const range = RANGES.find(r => r.id === choice);
  return `Sprint notes: ${range.title}${range.months ? ` (since ${monthsBefore(today, range.months)})` : ''}`;
}

export function exportFileName(choice, today) {
  if (choice.startsWith('archive/')) return `sprint-notes_${choice.replace('archive/', '').replace(/\.md$/, '')}.md`;
  const slug = RANGES.find(r => r.id === choice).title.replace(/\s+/g, '-');
  return `sprint-notes_${slug}_${today}.md`;
}

/**
 * Combine files into one markdown document. Each sprint starts with a level-1 heading; archives already have
 * `# Sprint ended …`, and the current sprint gets one here.
 * @param {{file: string, text: string}[]} entries in output order
 */
export function buildExport(entries, { title, today }) {
  const parts = entries.map(({ file, text }) => {
    const body = text.replace(/\r\n/g, '\n').trim();
    if (file === CURRENT) return `# Current sprint (as of ${today})\n\n${body}`;
    if (/^# /.test(body)) return body;
    const p = parseArchiveName(file);
    return `# Sprint ended ${p ? p.date : file}\n\n${body}`;
  });
  return `# ${title}\n\n_Exported ${today}_\n\n---\n\n${parts.join('\n\n---\n\n')}\n`;
}
