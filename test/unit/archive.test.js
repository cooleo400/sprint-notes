import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archiveDisplayName, archiveLabel, renamedArchive, sortArchives } from '../../src/archive.js';

test('archiveDisplayName shows the date, the same-day number, or the custom label', () => {
  assert.equal(archiveDisplayName('2026-10-23_sprint.md'), '2026-10-23');
  assert.equal(archiveDisplayName('archive/2026-10-23_sprint-2.md'), '2026-10-23-2');
  assert.equal(archiveDisplayName('2026-10-23_Launch week.md'), '2026-10-23 · Launch week');
  assert.equal(archiveDisplayName('notes.md'), 'notes');
});

test('archiveLabel returns the part after the date', () => {
  assert.equal(archiveLabel('2026-10-23_sprint-2.md'), 'sprint-2');
  assert.equal(archiveLabel('2026-10-23_Launch week.md'), 'Launch week');
});

test('renamedArchive keeps the date and tidies whitespace', () => {
  assert.deepEqual(renamedArchive('2026-10-23_sprint.md', '  Launch   week ', []), { name: '2026-10-23_Launch week.md' });
});

test('renamedArchive rejects empty, unsafe and duplicate names', () => {
  assert.ok(renamedArchive('2026-10-23_sprint.md', '  ', []).error);
  assert.ok(renamedArchive('2026-10-23_sprint.md', '../evil', []).error);
  assert.ok(renamedArchive('2026-10-23_sprint.md', 'a:b', []).error);
  assert.ok(renamedArchive('2026-10-23_sprint.md', '.hidden', []).error);
  assert.ok(renamedArchive('2026-10-23_sprint.md', 'x'.repeat(81), []).error);
  assert.ok(renamedArchive('2026-10-23_sprint.md', 'launch', ['2026-10-23_Launch.md']).error);
});

test('renamedArchive allows keeping the same name or changing only its case', () => {
  assert.deepEqual(renamedArchive('2026-10-23_launch.md', 'launch', ['2026-10-23_launch.md']), { name: '2026-10-23_launch.md' });
});

test('sortArchives keeps renamed sprints in date order', () => {
  assert.deepEqual(sortArchives(['2026-11-06_sprint.md', '2026-10-23_Launch.md', '2026-10-23_sprint-2.md']),
    ['2026-10-23_Launch.md', '2026-10-23_sprint-2.md', '2026-11-06_sprint.md']);
});
