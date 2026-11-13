import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArchiveName, sortArchives } from '../../src/archive.js';
import { monthsBefore, pickFiles, buildExport, exportTitle, exportFileName } from '../../src/export.js';

const ARCHIVES = ['2026-11-06_sprint.md', '2026-10-23_sprint-2.md', '2026-10-23_sprint.md', '2026-05-15_sprint.md', '2026-05-01_sprint.md', '2025-11-12_sprint.md', '2025-06-01_sprint.md'];
const TODAY = '2026-11-12';

test('parseArchiveName reads the date and same-day sequence number', () => {
  assert.deepEqual(parseArchiveName('2026-10-23_sprint.md'), { date: '2026-10-23', label: 'sprint', n: 1 });
  assert.deepEqual(parseArchiveName('archive/2026-10-23_sprint-3.md'), { date: '2026-10-23', label: 'sprint-3', n: 3 });
  assert.equal(parseArchiveName('notes.md'), null);
});

test('sortArchives orders oldest first and puts _sprint-2 after _sprint on the same day', () => {
  assert.deepEqual(sortArchives(ARCHIVES), [
    '2025-06-01_sprint.md', '2025-11-12_sprint.md', '2026-05-01_sprint.md', '2026-05-15_sprint.md',
    '2026-10-23_sprint.md', '2026-10-23_sprint-2.md', '2026-11-06_sprint.md'
  ]);
});

test('monthsBefore steps back whole months and clamps to shorter months', () => {
  assert.equal(monthsBefore('2026-11-12', 6), '2026-05-12');
  assert.equal(monthsBefore('2026-11-12', 12), '2025-11-12');
  assert.equal(monthsBefore('2026-08-31', 6), '2026-02-28');
  assert.equal(monthsBefore('2028-08-31', 6), '2028-02-29');
  assert.equal(monthsBefore('2026-03-15', 6), '2025-09-15');
});

test('pickFiles for the current sprint returns only current.md', () => {
  assert.deepEqual(pickFiles('current', ARCHIVES, TODAY), ['current.md']);
});

test('pickFiles for one archived sprint returns only that file', () => {
  assert.deepEqual(pickFiles('archive/2026-10-23_sprint-2.md', ARCHIVES, TODAY), ['archive/2026-10-23_sprint-2.md']);
});

test('pickFiles for the last 6 months includes archives on or after the cutoff, then the current sprint', () => {
  assert.deepEqual(pickFiles('months:6', ARCHIVES, TODAY), [
    'archive/2026-05-15_sprint.md', 'archive/2026-10-23_sprint.md', 'archive/2026-10-23_sprint-2.md', 'archive/2026-11-06_sprint.md', 'current.md'
  ]);
});

test('pickFiles for the last year includes an archive dated exactly one year ago', () => {
  const files = pickFiles('months:12', ARCHIVES, TODAY);
  assert.equal(files[0], 'archive/2025-11-12_sprint.md');
  assert.equal(files.includes('archive/2025-06-01_sprint.md'), false);
  assert.equal(files.at(-1), 'current.md');
});

test('pickFiles for everything includes every archive and the current sprint', () => {
  const files = pickFiles('all', [...ARCHIVES, 'renamed by hand.md'], TODAY);
  assert.equal(files.length, ARCHIVES.length + 2);
  assert.equal(files.at(-1), 'current.md');
});

test('pickFiles rejects an unknown choice', () => {
  assert.throws(() => pickFiles('weekly', ARCHIVES, TODAY), /Unknown export choice/);
});

test('buildExport joins sprints under one title, adding headings where a file has none', () => {
  const out = buildExport([
    { file: 'archive/2026-10-23_sprint.md', text: '# Sprint ended 2026-10-23\n\n## Today\n\n- [x] a\n' },
    { file: 'archive/2026-11-06_sprint.md', text: '## Today\r\n\r\n- [x] b\r\n' },
    { file: 'current.md', text: '## Today\n\n- [ ] c\n\n## This Month\n' }
  ], { title: 'Sprint notes: everything', today: TODAY });
  assert.equal(out, '# Sprint notes: everything\n\n_Exported 2026-11-12_\n\n---\n\n' +
    '# Sprint ended 2026-10-23\n\n## Today\n\n- [x] a\n\n---\n\n' +
    '# Sprint ended 2026-11-06\n\n## Today\n\n- [x] b\n\n---\n\n' +
    '# Current sprint (as of 2026-11-12)\n\n## Today\n\n- [ ] c\n\n## This Month\n');
});

test('exportTitle and exportFileName describe the choice', () => {
  assert.equal(exportTitle('months:6', TODAY), 'Sprint notes: last 6 months (since 2026-05-12)');
  assert.equal(exportTitle('archive/2026-10-23_sprint-2.md', TODAY), 'Sprint notes: sprint ended 2026-10-23 (#2)');
  assert.equal(exportTitle('all', TODAY), 'Sprint notes: everything');
  assert.equal(exportFileName('months:12', TODAY), 'sprint-notes_last-year_2026-11-12.md');
  assert.equal(exportFileName('current', TODAY), 'sprint-notes_current-sprint_2026-11-12.md');
  assert.equal(exportFileName('archive/2026-10-23_sprint-2.md', TODAY), 'sprint-notes_2026-10-23_sprint-2.md');
});
