import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitSections, joinSections, addTask, countSprintTasks, endSprint, restoreSprint } from '../../src/sprint.js';

const TEMPLATE = '## Today\n\n## This Week\n\n## This Month\n';

test('splitSections / joinSections round-trip and ignore headings inside code fences', () => {
  const md = 'intro\n\n## Today\n\n```\n## not a heading\n```\n\n## This Week\n- [ ] a\n';
  const secs = splitSections(md);
  assert.deepEqual(secs.map(s => s.name), [undefined, 'Today', 'This Week']);
  assert.equal(joinSections(secs), md);
});

test('addTask appends to the matching section, case-insensitively', () => {
  assert.equal(addTask(TEMPLATE, 'first', 'today'), '## Today\n\n- [ ] first\n\n## This Week\n\n## This Month\n');
  const twice = addTask(addTask(TEMPLATE, 'a', 'Today'), 'b', 'Today');
  assert.match(twice, /## Today\n\n- \[ \] a\n- \[ \] b\n\n## This Week/);
});

test('addTask creates a missing section at the end', () => {
  assert.equal(addTask('## Today\n', 'x', 'This Month'), '## Today\n\n## This Month\n\n- [ ] x\n');
  assert.equal(addTask('', 'x', 'Today'), '\n## Today\n\n- [ ] x\n');
});

test('addTask keeps special characters literally', () => {
  has(addTask(TEMPLATE, 'café $& "q" <b>x</b>', 'Today'), '- [ ] café $& "q" <b>x</b>\n');
});

test('countSprintTasks counts top-level tasks in Today and This Week only', () => {
  const md = '## Today\n\n- [x] a\n  - [ ] sub (not counted)\n- [ ] b\n\n## This Week\n\n- [X] c\n\n## This Month\n\n- [ ] m\n';
  assert.deepEqual(countSprintTasks(md), { done: 2, open: 1, total: 3 });
  assert.deepEqual(countSprintTasks(TEMPLATE), { done: 0, open: 0, total: 0 });
});

const MIX = '## Today\n\n- [x] done A\n  - note under A\n- [ ] open B\n  - [ ] child\n\n## This Week\n\n- [ ] open C\n- [x] done D\n\n## This Month\n\n- [ ] M\n';

test('endSprint with carry: archives done items with their notes, keeps open ones, leaves This Month', () => {
  const { archive, current } = endSprint(MIX, { carry: true, date: '2026-11-12' });
  assert.equal(archive, '# Sprint ended 2026-11-12\n\n## Today\n\n- [x] done A\n  - note under A\n\n## This Week\n\n- [x] done D\n');
  assert.equal(current, '## Today\n\n- [ ] open B\n  - [ ] child\n\n## This Week\n\n- [ ] open C\n\n## This Month\n\n- [ ] M\n');
});

test('endSprint without carry: archives open items marked not done and clears the slate', () => {
  const { archive, current } = endSprint(MIX, { carry: false, date: '2026-11-12' });
  has(archive, '- [ ] open B _(not done)_\n  - [ ] child', '- [ ] open C _(not done)_', '- [x] done D');
  assert.equal(current, '## Today\n\n## This Week\n\n## This Month\n\n- [ ] M\n');
});

test('endSprint handles loose lists (blank lines between items), as the editor writes them', () => {
  const loose = '## Today\n\n- [x] a\n\n  - note\n\n- [ ] b\n\n## This Week\n\n## This Month\n';
  const { archive, current } = endSprint(loose, { carry: true, date: 'd' });
  has(archive, '- [x] a\n\n  - note\n');
  assert.equal(current, '## Today\n\n- [ ] b\n\n## This Week\n\n## This Month\n');
});

test('endSprint keeps non-task text above the first task and marks empty sections', () => {
  const { archive, current } = endSprint('## Today\n\nfocus: ship it\n\n- [x] a\n\n## This Week\n', { carry: true, date: 'd' });
  has(archive, '## This Week\n\n_Nothing archived_');
  assert.equal(current, '## Today\n\nfocus: ship it\n\n## This Week\n');
});

function has(s, ...parts) { for (const p of parts) assert.ok(s.includes(p), `missing ${JSON.stringify(p)} in:\n${s}`); }

test('restoreSprint puts archived tasks back on top of the matching sections and drops not-done markers', () => {
  const archived = '# Sprint ended 2026-11-12\n\n## Today\n\n- [x] done A\n  - note under A\n- [ ] open B _(not done)_\n  - [ ] child\n\n## This Week\n\n_Nothing archived_\n';
  const current = '## Today\n\n- [ ] new today\n\n## This Week\n\n- [ ] new week\n\n## This Month\n\n- [ ] M\n';
  assert.equal(restoreSprint(current, archived),
    '## Today\n\n- [x] done A\n  - note under A\n- [ ] open B\n  - [ ] child\n- [ ] new today\n\n## This Week\n\n- [ ] new week\n\n## This Month\n\n- [ ] M\n');
});

test('restoreSprint undoes endSprint', () => {
  for (const carry of [true, false]) {
    const { archive, current } = endSprint(MIX, { carry, date: 'd' });
    const back = restoreSprint(current, archive);
    assert.deepEqual(back.split('\n').filter(Boolean).sort(), MIX.split('\n').filter(Boolean).sort(), `carry=${carry}`);
    assert.deepEqual(countSprintTasks(back), countSprintTasks(MIX));
  }
});

test('restoreSprint creates missing sections ahead of This Month', () => {
  const out = restoreSprint('## This Month\n\n- [ ] M\n', '# Sprint ended d\n\n## Today\n\n- [x] a\n\n## This Week\n\n- [x] w\n');
  assert.equal(out, '## Today\n\n- [x] a\n\n## This Week\n\n- [x] w\n\n## This Month\n\n- [ ] M\n');
});
