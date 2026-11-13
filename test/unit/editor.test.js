import './dom.js';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../../src/editor.js';
import { endSprint } from '../../src/sprint.js';

let ui, changes, parent;
beforeEach(() => {
  changes = 0;
  parent = document.createElement('div');
  document.body.appendChild(parent);
  ui = createEditor({ parent, onChange: () => changes++, onOpen: () => {}, askLink: async () => '' });
});
afterEach(() => { ui.editor.destroy(); parent.remove(); });

const view = () => ui.editor.view;

function press(combo) {
  const parts = combo.split('+'), key = parts.pop();
  const mods = new Set(parts);
  const event = new KeyboardEvent('keydown', {
    key, bubbles: true, cancelable: true,
    ctrlKey: mods.has('Ctrl'), metaKey: mods.has('Meta'), shiftKey: mods.has('Shift'), altKey: mods.has('Alt')
  });
  view().dom.dispatchEvent(event);
  return event.defaultPrevented;
}

function type(text) {
  for (const ch of text) {
    const v = view(), { from, to } = v.state.selection;
    const deflt = () => v.state.tr.insertText(ch, from, to);
    if (!v.someProp('handleTextInput', f => f(v, from, to, ch, deflt))) v.dispatch(deflt());
  }
}

function cursorAtEndOf(text) {
  let pos = null;
  ui.editor.state.doc.descendants((node, p) => {
    if (pos === null && node.isTextblock && node.textContent === text) pos = p + 1 + node.content.size;
  });
  assert.notEqual(pos, null, `no block with text ${JSON.stringify(text)}`);
  ui.editor.commands.setTextSelection(pos);
}

const cursorBlock = () => {
  const $from = ui.editor.state.selection.$from;
  return { text: $from.parent.textContent, item: $from.node($from.depth - 1).type.name };
};

const STABLE = [
  ['empty template', '## Today\n\n## This Week\n\n## This Month\n'],
  ['tight task list with nesting', '## Today\n\n- [x] done A\n- [ ] open B\n  - [ ] child\n  - detail\n'],
  ['task list mixed with bullets', '- plain\n  - nested\n- [x] done item\n- back to bullets\n'],
  ['inline marks', 'some **bold** and *it* and `code` and ~~gone~~\n'],
  ['labelled and bare links', 'see [site](https://example.com/a?b=1) and https://example.org/x\n'],
  ['headings, quote, rule', '# One\n\n## Two\n\n### Three\n\n> quote\n\n---\n'],
  ['task syntax inside a code fence', '```\n- [ ] inside fence\n## not a heading\n```\n'],
  ['literal angle brackets and ampersands', '- [ ] a < b && <b>x</b>\n'],
  ['numbered list', '1. one\n2. two\n']
];
for (const [name, md] of STABLE) {
  test(`round-trips ${name} unchanged`, () => {
    ui.set(md);
    assert.equal(ui.get(), md);
  });
}

test('does not linkify javascript: URLs', () => {
  ui.set('[bad](javascript:alert(1))\n');
  assert.equal(parent.querySelectorAll('a').length, 0);
});

test('does not render raw HTML from the file', () => {
  ui.set('<img src=x onerror="window.__x=1">\n');
  assert.equal(parent.querySelectorAll('.tiptap img').length, 0);
});

test('loading a file or switching read-only does not report a change', () => {
  ui.set('## Today\n\n- [ ] a\n');
  ui.setReadOnly(true);
  ui.setReadOnly(false);
  assert.equal(changes, 0);
});

test('a user-initiated set and typing report changes', () => {
  ui.set('x\n', true);
  assert.equal(changes, 1);
  cursorAtEndOf('x');
  type('y');
  assert.equal(changes, 2);
});

for (const combo of ['Ctrl+t', 'Meta+t']) {
  test(`${combo} turns the current line into a to-do and keeps the cursor on that line`, () => {
    ui.set('## Today\n\nhello\n\nnext line\n');
    cursorAtEndOf('hello');
    assert.equal(press(combo), true);
    assert.deepEqual(cursorBlock(), { text: 'hello', item: 'taskItem' });
    type(' world');
    assert.equal(ui.get(), '## Today\n\n- [ ] hello world\n\nnext line\n');
  });
}

test('Ctrl+t on an empty line creates a to-do the user can type into', () => {
  ui.set('## Today\n');
  ui.editor.commands.focus('end');
  press('Enter');
  press('Ctrl+t');
  type('new task');
  assert.deepEqual(cursorBlock(), { text: 'new task', item: 'taskItem' });
  assert.equal(ui.get(), '## Today\n\n- [ ] new task\n');
});

test('Ctrl+t on a to-do turns it back into plain text', () => {
  ui.set('- [ ] task\n');
  cursorAtEndOf('task');
  press('Ctrl+t');
  assert.equal(ui.get(), 'task\n');
});

test('Ctrl+b bolds the selection and toggles bold for new text', () => {
  ui.set('hello world\n');
  ui.editor.commands.setTextSelection({ from: 7, to: 12 });
  assert.equal(press('Ctrl+b'), true);
  assert.equal(ui.get(), 'hello **world**\n');
  cursorAtEndOf('hello world');
  press('Ctrl+b');
  type('!');
  assert.equal(ui.get(), 'hello **world**!\n');
});

test('Ctrl+Enter and Meta+Enter toggle a to-do', () => {
  ui.set('- [ ] task\n');
  cursorAtEndOf('task');
  press('Ctrl+Enter');
  assert.equal(ui.get(), '- [x] task\n');
  press('Meta+Enter');
  assert.equal(ui.get(), '- [ ] task\n');
});

for (const [trigger, expected] of [['* ', '- item\n'], ['- ', '- item\n'], ['[] ', '- [ ] item\n'], ['1. ', '1. item\n'], ['## ', '## item\n'], ['> ', '> item\n']]) {
  test(`typing "${trigger}" at the start of a line formats it without leaving the syntax visible`, () => {
    ui.set('');
    ui.editor.commands.focus('start');
    type(trigger + 'item');
    assert.equal(ui.get(), expected);
    assert.equal(parent.textContent.includes(trigger.trim()), false);
  });
}

test('Tab nests a to-do under the previous one and Shift+Tab lifts it back', () => {
  ui.set('- [ ] parent\n- [ ] child\n');
  cursorAtEndOf('child');
  assert.equal(press('Tab'), true);
  assert.equal(ui.get(), '- [ ] parent\n  - [ ] child\n');
  assert.equal(press('Shift+Tab'), true);
  assert.equal(ui.get(), '- [ ] parent\n- [ ] child\n');
});

test('Tab nests a bullet under the previous bullet', () => {
  ui.set('- one\n- two\n');
  cursorAtEndOf('two');
  press('Tab');
  assert.equal(ui.get(), '- one\n  - two\n');
});

test('Tab outside a list is swallowed so focus stays in the editor', () => {
  ui.set('plain\n');
  cursorAtEndOf('plain');
  assert.equal(press('Tab'), true);
  assert.equal(ui.get(), 'plain\n');
});

test('Enter in a to-do starts a new to-do; Enter on an empty one leaves the list', () => {
  ui.set('- [ ] a\n');
  cursorAtEndOf('a');
  press('Enter');
  type('b');
  assert.equal(ui.get(), '- [ ] a\n- [ ] b\n');
  press('Enter');
  press('Enter');
  type('after');
  assert.equal(ui.get(), '- [ ] a\n- [ ] b\n\nafter\n');
});

test('text typed in the editor survives End sprint and reloads unchanged', () => {
  ui.set('## Today\n\n## This Week\n\n## This Month\n');
  cursorAtEndOf('Today');
  press('Enter');
  press('Ctrl+t');
  type('shipped');
  press('Enter');
  type('sub step');
  press('Tab');
  press('Enter');
  press('Shift+Tab');
  type('still open');
  cursorAtEndOf('shipped');
  press('Ctrl+Enter');
  const md = ui.get();
  assert.equal(md, '## Today\n\n- [x] shipped\n  - [ ] sub step\n- [ ] still open\n\n## This Week\n\n## This Month\n');

  const { archive, current } = endSprint(md, { carry: true, date: 'd' });
  assert.match(archive, /- \[x\] shipped\n {2}- \[ \] sub step\n/);
  ui.set(current);
  assert.equal(ui.get(), '## Today\n\n- [ ] still open\n\n## This Week\n\n## This Month\n');
});

const INDENT = [
  ['a bullet under a to-do', '- [ ] task\n\n- bullet\n', 'bullet', '- [ ] task\n\n  - bullet\n'],
  ['a to-do under a bullet', '- bullet\n- [ ] task\n', 'task', '- bullet\n  - [ ] task\n'],
  ['a heading under a to-do', '- [ ] task\n\n### Heading\n', 'Heading', '- [ ] task\n\n  ### Heading\n'],
  ['a paragraph under a to-do', '- [ ] task\n\nnotes here\n', 'notes here', '- [ ] task\n\n  notes here\n'],
  ['a to-do into an existing nested list', '- [ ] a\n  - [ ] b\n- [ ] c\n', 'c', '- [ ] a\n  - [ ] b\n  - [ ] c\n']
];
for (const [name, md, line, expected] of INDENT) {
  test(`Tab nests ${name} and Shift+Tab moves it back out`, () => {
    ui.set(md);
    cursorAtEndOf(line);
    assert.equal(press('Tab'), true);
    assert.equal(ui.get(), expected);
    assert.equal(cursorBlock().text, line);
    ui.set(ui.get());
    assert.equal(ui.get(), expected);
    cursorAtEndOf(line);
    assert.equal(press('Shift+Tab'), true);
    assert.equal(ui.get().replace(/\n\n/g, '\n'), md.replace(/\n\n/g, '\n'));
  });
}

test('Shift+Tab on a nested paragraph keeps the following items in order', () => {
  ui.set('- [ ] task\n\n  notes here\n- [ ] next\n');
  cursorAtEndOf('notes here');
  press('Shift+Tab');
  assert.equal(ui.get(), '- [ ] task\n\nnotes here\n\n- [ ] next\n');
});

test('Tab does not nest the Today / This Week / This Month headings', () => {
  ui.set('## Today\n\n- [ ] a\n\n## This Week\n');
  cursorAtEndOf('This Week');
  assert.equal(press('Tab'), true);
  assert.equal(ui.get(), '## Today\n\n- [ ] a\n\n## This Week\n');
});

test('Tab on a block with no list above it leaves the document unchanged', () => {
  ui.set('## Today\n\n- [ ] first\n');
  cursorAtEndOf('first');
  assert.equal(press('Tab'), true);
  assert.equal(ui.get(), '## Today\n\n- [ ] first\n');
});

test('End sprint keeps blocks nested with Tab under their to-do', () => {
  ui.set('## Today\n\n- [x] task\n\n### Notes\n\n## This Week\n');
  cursorAtEndOf('Notes');
  press('Tab');
  const { archive } = endSprint(ui.get(), { carry: true, date: 'd' });
  assert.match(archive, /- \[x\] task\n\n {2}### Notes\n/);
});

const SECTIONS = '## Today\n\n- [ ] a\n- [ ] b\n\nnote\n\n## This Week\n\n- [ ] w\n\n## This Month\n\n- [ ] m\n';
const hidden = () => [...parent.querySelectorAll('.fold-hidden')].map(e => e.matches('p') ? e.textContent : [...e.querySelectorAll('p')].map(p => p.textContent).join(''));
const toggles = () => [...parent.querySelectorAll('.fold-toggle')];

test('every ## section heading gets a fold toggle', () => {
  ui.set(SECTIONS);
  assert.equal(toggles().length, 3);
  assert.deepEqual(toggles().map(b => b.getAttribute('aria-expanded')), ['true', 'true', 'true']);
});

test('folding a section hides everything up to the next section and shows how many items are hidden', () => {
  ui.set(SECTIONS);
  ui.toggleFold('Today');
  assert.deepEqual(hidden(), ['ab', 'note']);
  assert.equal(parent.querySelector('.fold-count').textContent, '3 hidden');
  assert.equal(toggles()[0].getAttribute('aria-expanded'), 'false');
  ui.toggleFold('today');
  assert.deepEqual(hidden(), []);
});

test('clicking the toggle folds the section and reports the folded names', () => {
  const reported = [];
  ui.editor.destroy();
  ui = createEditor({ parent, onChange: () => changes++, onOpen() {}, askLink: async () => '', onFoldChange: n => reported.push(n) });
  ui.set(SECTIONS);
  toggles()[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  assert.deepEqual(hidden(), ['w']);
  assert.deepEqual(reported, [['this week']]);
});

test('folding never changes the document or reports an edit', () => {
  ui.set(SECTIONS);
  ui.toggleFold('Today');
  ui.toggleFold('This Month');
  assert.equal(ui.get(), SECTIONS);
  assert.equal(changes, 0);
});

test('folded sections stay folded when the document is reloaded or edited', () => {
  ui.set(SECTIONS);
  ui.setFolded(['This Week']);
  ui.set(SECTIONS.replace('- [ ] w', '- [ ] w\n- [ ] w2'));
  assert.deepEqual(hidden(), ['ww2']);
  assert.deepEqual(ui.folded(), ['this week']);
});

test('folding the section that holds the cursor moves the cursor onto its heading', () => {
  ui.set(SECTIONS);
  cursorAtEndOf('b');
  ui.toggleFold('Today');
  assert.equal(cursorBlock().text, 'Today');
});

test('the cursor skips over a folded section when moving into it', () => {
  ui.set(SECTIONS);
  ui.toggleFold('This Week');
  cursorAtEndOf('a');
  cursorAtEndOf('w');
  assert.equal(cursorBlock().text, 'This Month');
  cursorAtEndOf('m');
  cursorAtEndOf('w');
  assert.equal(cursorBlock().text, 'This Week');
});

test('only ## headings fold; # and ### headings do not get a toggle', () => {
  ui.set('# Title\n\n### Small\n\n## Today\n');
  assert.equal(toggles().length, 1);
});

test('Tab on a nested bullet that cannot nest further leaves the to-dos above it alone', () => {
  ui.set('- [ ] s\n- [ ] t\n  - a\n  - b\n');
  cursorAtEndOf('b');
  press('Tab');
  assert.equal(ui.get(), '- [ ] s\n- [ ] t\n  - a\n    - b\n');
  press('Tab');
  press('Tab');
  assert.equal(ui.get(), '- [ ] s\n- [ ] t\n  - a\n    - b\n');
});

test('Shift+Tab on a nested bullet moves only that bullet and keeps the parent to-do', () => {
  ui.set('- [ ] t\n  - a\n    - b\n- [ ] u\n');
  cursorAtEndOf('b');
  press('Shift+Tab');
  assert.equal(ui.get(), '- [ ] t\n  - a\n  - b\n- [ ] u\n');
  press('Shift+Tab');
  assert.equal(ui.get(), '- [ ] t\n  - a\n- b\n- [ ] u\n');
});

test('Shift+Tab on a nested to-do under a bullet keeps the parent bullet', () => {
  ui.set('- a\n  - [ ] x\n- b\n');
  cursorAtEndOf('x');
  press('Shift+Tab');
  assert.equal(ui.get(), '- a\n- [ ] x\n- b\n');
});

test('Enter in a bullet nested under a to-do starts a new bullet, not a new to-do', () => {
  ui.set('- [ ] t\n  - a\n');
  cursorAtEndOf('a');
  press('Enter');
  type('b');
  assert.equal(ui.get(), '- [ ] t\n  - a\n  - b\n');
});

test('Ctrl+t on one bullet turns only that bullet into a to-do', () => {
  ui.set('- a\n- b\n- c\n');
  cursorAtEndOf('b');
  press('Ctrl+t');
  assert.equal(ui.get(), '- a\n- [ ] b\n- c\n');
  assert.deepEqual(cursorBlock(), { text: 'b', item: 'taskItem' });
});

test('the bullet and number commands convert only the selected to-dos', () => {
  ui.set('- [ ] a\n- [x] b\n- [ ] c\n- [ ] d\n');
  cursorAtEndOf('b');
  ui.run('bullet');
  assert.equal(ui.get(), '- [ ] a\n- b\n- [ ] c\n- [ ] d\n');
  ui.editor.commands.setTextSelection({ from: posOfEnd('c') - 1, to: posOfEnd('d') });
  ui.run('number');
  assert.equal(ui.get(), '- [ ] a\n- b\n\n1. c\n2. d\n');
});

test('converting keeps nested items and their types', () => {
  ui.set('- a\n  - [ ] child\n- b\n');
  cursorAtEndOf('a');
  press('Ctrl+t');
  assert.equal(ui.get(), '- [ ] a\n  - [ ] child\n- b\n');
});

function posOfEnd(text) {
  let pos = null;
  ui.editor.state.doc.descendants((node, p) => { if (pos === null && node.isTextblock && node.textContent === text) pos = p + 1 + node.content.size; });
  return pos;
}

const jiraLinks = () => [...parent.querySelectorAll('.jira-link')].map(e => [e.textContent, e.getAttribute('data-href')]);

test('Jira keys show as links only once a Jira address is set, and the file keeps the plain key', () => {
  ui.set('- [ ] Fix RA-12 and CORE-7\n');
  assert.deepEqual(jiraLinks(), []);
  ui.setJira({ base: 'https://acme.atlassian.net', keys: ['RA'] });
  assert.deepEqual(jiraLinks(), [['RA-12', 'https://acme.atlassian.net/browse/RA-12']]);
  assert.equal(ui.get(), '- [ ] Fix RA-12 and CORE-7\n');
  assert.equal(changes, 0);
});

test('Jira links update while typing and skip code and existing links', () => {
  ui.setJira({ base: 'https://acme.atlassian.net', keys: [] });
  ui.set('`RA-1` and [RA-2](https://x.y) and\n\n```\nRA-3\n```\n');
  assert.deepEqual(jiraLinks(), []);
  cursorAtEndOf('RA-1 and RA-2 and');
  type(' RA-4');
  assert.deepEqual(jiraLinks().map(l => l[0]), ['RA-4']);
});

test('clicking a Jira link opens the issue', () => {
  const opened = [];
  ui.editor.destroy();
  ui = createEditor({ parent, onChange() {}, onOpen: u => opened.push(u), askLink: async () => '' });
  ui.setJira({ base: 'https://acme.atlassian.net', keys: [] });
  ui.set('see RA-9\n');
  parent.querySelector('.jira-link').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.deepEqual(opened, ['https://acme.atlassian.net/browse/RA-9']);
});

function paste(text) {
  const event = { clipboardData: { getData: type => (type === 'text/plain' ? text : '') }, preventDefault() {} };
  return view().props.handlePaste(view(), event, null);
}

test('pasting a Jira issue URL inserts a link that reads just the key', () => {
  ui.set('- [ ] review\n');
  cursorAtEndOf('review');
  type(' ');
  assert.equal(paste('https://animoto.atlassian.net/browse/RA-483'), true);
  type(' today');
  assert.equal(ui.get(), '- [ ] review [RA-483](https://animoto.atlassian.net/browse/RA-483) today\n');
  assert.equal(parent.querySelector('a').textContent, 'RA-483');
});

test('pasting other URLs, or a Jira URL over selected text, is left to the default paste', () => {
  ui.set('some text\n');
  cursorAtEndOf('some text');
  assert.ok(!paste('https://example.com/browse/page'));
  ui.editor.commands.setTextSelection({ from: 1, to: 5 });
  assert.ok(!paste('https://animoto.atlassian.net/browse/RA-483'));
});
