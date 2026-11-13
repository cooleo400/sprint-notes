/*
 * Archive filenames: `YYYY-MM-DD_<label>.md`. End sprint writes the label `sprint`, or `sprint-N` for the Nth
 * sprint ended on the same day; renaming changes only the label, so the date (used for sorting and export
 * ranges) is kept.
 */

/** @returns {{date: string, label: string, n: number} | null} */
export function parseArchiveName(name) {
  const m = /^(?:archive\/)?(\d{4}-\d{2}-\d{2})_(.+)\.md$/.exec(name);
  if (!m) return null;
  const seq = /^sprint(?:-(\d+))?$/.exec(m[2]);
  return { date: m[1], label: m[2], n: seq && seq[1] ? +seq[1] : 1 };
}

/** Oldest first. `_sprint-2.md` sorts after `_sprint.md` from the same day, unlike a plain string sort. */
export function sortArchives(names) {
  const key = n => { const p = parseArchiveName(n); return p ? `${p.date}#${String(p.n).padStart(4, '0')}#${p.label}` : n; };
  return [...names].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

/** Sidebar label: the date, with `-N` for same-day sprints or the custom label after a rename. */
export function archiveDisplayName(name) {
  const p = parseArchiveName(name);
  if (!p) return name.replace(/^archive\//, '').replace(/\.md$/, '');
  if (/^sprint(-\d+)?$/.test(p.label)) return p.date + (p.n > 1 ? `-${p.n}` : '');
  return `${p.date} · ${p.label}`;
}

/** The editable part of a name, shown in the rename box. */
export function archiveLabel(name) {
  const p = parseArchiveName(name);
  return p ? p.label : name.replace(/^archive\//, '').replace(/\.md$/, '');
}

/**
 * New filename for a rename, or an error message.
 * @param {string} name current filename (without `archive/`)
 * @param {string} label what the user typed
 * @param {string[]} existing filenames already in the archive
 * @returns {{name: string} | {error: string}}
 */
export function renamedArchive(name, label, existing) {
  const clean = label.trim().replace(/\s+/g, ' ');
  if (!clean) return { error: 'Enter a name.' };
  if (/[/\\:]/.test(clean) || clean.startsWith('.')) return { error: 'Names can’t contain / \\ : or start with a dot.' };
  if (clean.length > 80) return { error: 'Keep the name under 80 characters.' };
  const p = parseArchiveName(name);
  const next = `${p ? p.date : name.replace(/\.md$/, '')}_${clean}.md`;
  if (next !== name && existing.some(e => e.toLowerCase() === next.toLowerCase())) return { error: 'Another archived sprint already has that name.' };
  return { name: next };
}
