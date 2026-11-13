/* Pure markdown transforms for sections, quick add and End sprint. No DOM access, so they can be unit-tested. */

export const SPRINT_SECTIONS = ['Today', 'This Week'];

const fenceMask = lines => { let inFence = false; return lines.map(l => (/^\s*(```|~~~)/.test(l) ? ((inFence = !inFence), true) : inFence)); };
const same = (a, b) => (a || '').toLowerCase() === b.toLowerCase();
const trimEnd = a => { while (a.length && !a[a.length - 1].trim()) a.pop(); return a; };
const isDone = item => /^- \[[xX]\]/.test(item[0]);

/**
 * Split markdown into `## ` sections. Headings inside code fences are ignored.
 * @param {string} text
 * @returns {{name?: string, head: string|null, body: string[]}[]} the first entry holds text before any heading
 */
export function splitSections(text) {
  const out = []; let cur = { head: null, body: [] };
  const lines = text.split('\n'), fenced = fenceMask(lines);
  for (const [i, l] of lines.entries()) {
    const m = fenced[i] ? null : l.match(/^##\s+(.*)/);
    if (m) { out.push(cur); cur = { name: m[1].trim(), head: l, body: [] }; } else cur.body.push(l);
  }
  out.push(cur);
  return out;
}

export const joinSections = secs => secs.flatMap(s => (s.head !== null ? [s.head, ...s.body] : s.body)).join('\n');

/**
 * Append an unchecked task to a section (matched case-insensitively), creating the section if missing.
 * @returns {string} the new markdown
 */
export function addTask(text, task, section) {
  const secs = splitSections(text);
  let s = secs.find(x => x.name && same(x.name, section));
  if (!s) { s = { name: section, head: '## ' + section, body: [] }; secs.push(s); }
  if (!trimEnd(s.body).length) s.body.push('');
  s.body.push('- [ ] ' + task, '');
  return joinSections(secs);
}

/** Group a section body into top-level task items, each with the lines (sub-items, notes) under it. */
function items(body) {
  const its = [], pre = [];
  for (const l of body) {
    if (/^- \[[ xX]\]/.test(l)) its.push([l]);
    else if (its.length) its[its.length - 1].push(l); else pre.push(l);
  }
  return { pre, its: its.map(trimEnd) };
}

function sprintSections(text) {
  const secs = splitSections(text);
  const parsed = secs.filter(s => s.name && SPRINT_SECTIONS.some(n => same(s.name, n))).map(s => ({ s, ...items(s.body) }));
  return { secs, parsed };
}

/** Count top-level tasks in Today and This Week. */
export function countSprintTasks(text) {
  const all = sprintSections(text).parsed.flatMap(p => p.its);
  const done = all.filter(isDone).length;
  return { done, open: all.length - done, total: all.length };
}

/**
 * Archive Today and This Week.
 * @param {string} text current markdown
 * @param {{carry: boolean, date: string}} opts carry: keep unfinished tasks in place instead of archiving them as not done
 * @returns {{archive: string, current: string}}
 */
export function endSprint(text, { carry, date }) {
  const { secs, parsed } = sprintSections(text);
  let archive = `# Sprint ended ${date}\n`;
  for (const p of parsed) {
    const list = p.its.filter(it => isDone(it) || !carry).map(it => (isDone(it) ? it : [it[0] + ' _(not done)_', ...it.slice(1)]));
    archive += `\n## ${p.s.name}\n\n${list.map(it => it.join('\n')).join('\n') || '_Nothing archived_'}\n`;
    const keep = [...trimEnd(p.pre), ...(carry ? p.its.filter(it => !isDone(it)).flat() : [])];
    p.s.body = keep.length ? [...(keep[0] === '' ? [] : ['']), ...keep, ''] : [''];
  }
  return { archive, current: joinSections(secs) };
}

/**
 * Move an archived sprint's tasks back into the current sprint, undoing End sprint: each archived section's
 * items go to the top of the matching current section (created if missing), with the `_(not done)_` markers that
 * End sprint added removed. Current tasks are kept.
 * @param {string} current current sprint markdown
 * @param {string} archived archived sprint markdown
 * @returns {string} the new current markdown
 */
export function restoreSprint(current, archived) {
  const secs = splitSections(current.replace(/\r\n/g, '\n'));
  for (const a of splitSections(archived.replace(/\r\n/g, '\n'))) {
    if (!a.name) continue;
    const lines = a.body.filter(l => l.trim() !== '_Nothing archived_').map(l => l.replace(/ _\(not done\)_$/, ''));
    while (lines.length && !lines[0].trim()) lines.shift();
    trimEnd(lines);
    if (!lines.length) continue;
    let s = secs.find(x => x.name && same(x.name, a.name));
    if (!s) {
      // Keep Today / This Week ahead of later sections such as This Month.
      s = { name: a.name, head: '## ' + a.name, body: [''] };
      const later = secs.findIndex(x => x.name && !SPRINT_SECTIONS.some(n => same(x.name, n)));
      const isSprint = SPRINT_SECTIONS.some(n => same(a.name, n));
      secs.splice(isSprint && later > 0 ? later : secs.length, 0, s);
    }
    const rest = [...s.body];
    while (rest.length && !rest[0].trim()) rest.shift();
    trimEnd(rest);
    s.body = ['', ...lines, ...rest, ''];
  }
  return joinSections(secs);
}
