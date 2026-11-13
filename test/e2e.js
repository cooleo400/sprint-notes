const { _electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const today = new Date().toLocaleDateString('en-CA');
const results = [];
const G = w => w.evaluate(() => window.__editor.get());
const S = (w, t, user) => w.evaluate(([t, u]) => window.__editor.set(t, u), [t, !!user]);

async function launch(o = {}) {
  const dir = o.dir || fs.mkdtempSync(path.join(os.tmpdir(), 'notes-'));
  const ud = o.ud || fs.mkdtempSync(path.join(os.tmpdir(), 'ud-'));
  const cfgFile = path.join(ud, 'config.json');
  const prev = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')) : {};
  fs.writeFileSync(cfgFile, JSON.stringify({ ...prev, ...(o.config || {}), root: dir }));
  fs.mkdirSync(path.join(dir, 'archive'), { recursive: true });
  if (o.pre !== undefined) fs.writeFileSync(path.join(dir, 'current.md'), o.pre);
  for (const [n, t] of Object.entries(o.archives || {})) fs.writeFileSync(path.join(dir, 'archive', n), t);
  const app = await _electron.launch({ args: ['--no-sandbox', '--disable-gpu', '--user-data-dir=' + ud, '.'], cwd: path.join(__dirname, '..') });
  const win = await app.firstWindow();
  await win.waitForFunction(() => document.querySelector('#title').textContent.length > 0);
  return {
    app, win, dir, ud,
    cur: () => fs.readFileSync(path.join(dir, 'current.md'), 'utf8'),
    arch: () => fs.readdirSync(path.join(dir, 'archive')).sort(),
    read: n => fs.readFileSync(path.join(dir, 'archive', n), 'utf8'),
    settle: () => win.waitForTimeout(900),
    async endSprint(choice) {
      await win.click('#end');
      await win.waitForSelector('#dlg[open]');
      const msg = await win.textContent('#dmsg');
      if (choice) await win.click(choice); else await win.keyboard.press('Escape');
      await win.waitForFunction(() => !document.querySelector('#dlg').open);
      await win.waitForTimeout(400);
      return msg;
    }
  };
}
async function test(name, o, fn) {
  if (typeof o === 'function') { fn = o; o = {}; }
  if (process.env.ONLY && !name.startsWith(process.env.ONLY)) return;
  let c;
  try { c = await launch(o); await fn(c); results.push(['PASS', name]); }
  catch (e) { if (process.env.VERBOSE) console.error(e); results.push(['FAIL', name, String(e.message).split('\n').slice(0, 4).join(' | ').slice(0, 300)]); }
  finally { if (c) await c.app.close().catch(() => {}); }
}
const has = (s, ...parts) => parts.forEach(p => assert.ok(s.includes(p), `missing ${JSON.stringify(p)} in:\n${s}`));
const lacks = (s, ...parts) => parts.forEach(p => assert.ok(!s.includes(p), `unexpected ${JSON.stringify(p)} in:\n${s}`));
const ED = '.tiptap', BOX = '.tiptap input[type=checkbox]';
const toEnd = async w => { await w.click(ED); await w.evaluate(() => window.__editor.editor.commands.focus('end')); };

(async () => {
await test('01 first run: template, archive dir, empty archive list', async c => {
  assert.equal(c.cur(), '## Today\n\n## This Week\n\n## This Month\n');
  assert.equal(await c.win.textContent('#title'), 'Current sprint');
  has(await c.win.textContent('#arch'), 'No sprints archived yet');
});

await test('02 quick add: each section, special chars, empty ignored, focus stays', async c => {
  const { win } = c;
  await win.fill('#add', 'Ship café ☕ $& "q" <b>x</b>'); await win.press('#add', 'Enter');
  assert.equal(await win.inputValue('#add'), '');
  assert.equal(await win.evaluate(() => document.activeElement.id), 'add');
  await win.selectOption('#sec', 'This Week'); await win.fill('#add', 'weekly'); await win.press('#add', 'Enter');
  await win.selectOption('#sec', 'This Month'); await win.fill('#add', 'monthly'); await win.press('#add', 'Enter');
  await win.fill('#add', '   '); await win.press('#add', 'Enter');
  await win.selectOption('#sec', 'Today'); await win.fill('#add', 'second today'); await win.press('#add', 'Enter');
  await c.settle();
  assert.match(c.cur(), /## Today\n+- \[ \] Ship café ☕ \$& "q" <b>x<\/b>\n- \[ \] second today\n+## This Week\n+- \[ \] weekly\n+## This Month\n+- \[ \] monthly/);
});

await test('03 typing: autosave, list continuation, Tab / Shift+Tab, empty-item exit', async c => {
  const { win } = c;
  await S(win, '## Today\n\n- [ ] a', true);
  await win.locator('.tiptap li', { hasText: 'a' }).click(); await win.keyboard.press('End');
  await win.keyboard.press('Enter'); await win.keyboard.type('b'); await win.keyboard.press('Tab');
  assert.equal(await G(win), '## Today\n\n- [ ] a\n  - [ ] b\n');
  await win.keyboard.press('Shift+Tab');
  assert.equal(await G(win), '## Today\n\n- [ ] a\n- [ ] b\n');
  await win.keyboard.press('Enter'); await win.keyboard.press('Enter');
  await win.keyboard.type('after');
  assert.equal(await G(win), '## Today\n\n- [ ] a\n- [ ] b\n\nafter\n', 'Enter on an empty item should leave the list');
  assert.equal(await win.evaluate(() => document.activeElement.classList.contains('tiptap')), true);
  await c.settle();
  has(c.cur(), '- [ ] a\n- [ ] b\n\nafter');
});

await test('04 checkboxes in the editor toggle the right source line', { pre: '## Today\n\n- [ ] one\n  - [ ] one-a\n  - [x] one-b\n- [ ] two\n\n```\n- [ ] inside fence\n```\n\n- [ ] three\n' }, async c => {
  const { win } = c;
  const boxes = win.locator(BOX);
  assert.equal(await boxes.count(), 5);
  await boxes.nth(4).click(); await boxes.nth(2).click(); await boxes.nth(1).click(); await c.settle();
  const t = c.cur();
  has(t, '- [x] three', '  - [x] one-a', '  - [ ] one-b', '- [ ] inside fence');
  lacks(t, '- [x] inside fence');
});

await test('05 links: click opens, only http(s), no navigation, syntax never shown', { pre: '## Today\n\n- [ ] see [site](https://example.com/a?b=1) and https://example.org/x\n- [ ] [bad](javascript:window.__x=1)\n' }, async c => {
  const { win, app } = c;
  await app.evaluate(({ shell }) => { global.__opened = []; shell.openExternal = u => { global.__opened.push(u); return Promise.resolve(); }; });
  const line = await win.locator('li', { hasText: 'see' }).textContent();
  assert.ok(!line.includes(']('), 'link syntax should be hidden: ' + line);
  await win.locator('.tiptap a', { hasText: 'site' }).click();
  has(await win.locator('li', { hasText: 'see' }).textContent(), 'see site and');
  await win.locator('.tiptap a', { hasText: 'https://example.org/x' }).click();
  assert.equal(await win.locator('.tiptap a', { hasText: 'bad' }).count(), 0, 'javascript: links are not rendered as links');
  await win.waitForTimeout(300);
  assert.deepEqual(await app.evaluate(() => global.__opened), ['https://example.com/a?b=1', 'https://example.org/x']);
  assert.equal(await win.evaluate(() => window.__x), undefined);
  assert.ok((await win.evaluate(() => location.href)).startsWith('file://'));
  await c.win.evaluate(() => window.__editor.editor.commands.insertContent(' '));
  await c.settle();
  has(c.cur(), '[site](https://example.com/a?b=1) and https://example.org/x');
});

const SPRINT = '## Today\n\n- [x] Ship release\n  - notes line 1\n  - [ ] subtask open\n\n    paragraph after blank\n- [x] Review PR https://example.com/pr/1\n- [x] Third\n\n## This Week\n\n- [x] Write doc\n\n## This Month\n\n- [ ] Plan Q1\n  - sub detail\n';
await test('06 end sprint, all done: archived with sub-notes, slate cleared, month kept', { pre: SPRINT }, async c => {
  const msg = await c.endSprint('#dcarry');
  has(msg, 'Archive 4 completed');
  assert.deepEqual(c.arch(), [`${today}_sprint.md`]);
  const a = c.read(`${today}_sprint.md`);
  has(a, `# Sprint ended ${today}`, '## Today', '- [x] Ship release\n\n  - notes line 1\n\n  - [ ] subtask open\n\n    paragraph after blank', '- [x] Review PR', '- [x] Third', '## This Week', '- [x] Write doc');
  lacks(a, 'Plan Q1');
  assert.match(c.cur(), /^## Today\n\n## This Week\n\n## This Month\n\n- \[ \] Plan Q1\n  - sub detail\n$/);
  has(await c.win.textContent('#arch'), today);
  has(await G(c.win), '## This Month');
});

const MIX = '## Today\n\n- [x] done A\n- [ ] open B\n  - [ ] child\n  - detail\n\n## This Week\n\n- [ ] open C\n- [x] done D\n\n## This Month\n\n- [ ] M\n';
await test('07 carry over, then archive remaining as not done (same-day -2 file)', { pre: MIX }, async c => {
  const msg = await c.endSprint('#dcarry');
  has(msg, '2 unfinished', '2 completed');
  const a = c.read(`${today}_sprint.md`);
  has(a, 'done A', 'done D'); lacks(a, 'open B', 'open C');
  assert.match(c.cur(), /## Today\n\n- \[ \] open B\n  - \[ \] child\n  - detail\n\n## This Week\n\n- \[ \] open C\n\n## This Month\n\n- \[ \] M\n/);
  await c.endSprint('#darch');
  assert.deepEqual(c.arch(), [`${today}_sprint-2.md`, `${today}_sprint.md`]);
  has(c.read(`${today}_sprint-2.md`), '- [ ] open B _(not done)_\n  - [ ] child\n  - detail', '- [ ] open C _(not done)_');
  assert.match(c.cur(), /^## Today\n\n## This Week\n\n## This Month\n\n- \[ \] M\n$/);
  assert.equal(await c.win.locator('#arch li[data-f]').count(), 2);
});

await test('08 cancel button and Escape change nothing', { pre: MIX }, async c => {
  await c.endSprint('#dlg button[value=cancel]'); await c.endSprint(null);
  assert.equal(c.cur(), MIX); assert.deepEqual(c.arch(), []);
});

await test('09 archived sprint opens read-only (no typing, no toolbar, disabled checkboxes)', { archives: { '2026-01-09_sprint.md': '# Sprint ended 2026-01-09\n\n## Today\n\n- [x] old task\n' } }, async c => {
  const { win } = c;
  await win.click('#arch li[data-f]');
  await win.waitForFunction(() => document.querySelector('#title').textContent.includes('read-only'));
  assert.ok(await win.isHidden('#bar')); assert.ok(await win.isHidden('#fmt')); assert.ok(await win.isHidden('#end'));
  const before = await G(win);
  await win.locator(BOX).first().click({ force: true });
  await win.click(ED); await win.keyboard.type('hacked');
  assert.equal(await G(win), before);
  assert.equal(await win.getAttribute(ED, 'contenteditable'), 'false');
  await win.click('#curnav');
  await win.waitForFunction(() => document.querySelector('#title').textContent === 'Current sprint');
  assert.ok(await win.isVisible('#fmt'));
});

const ARCH = { '2026-01-09_sprint.md': '## Today\n\n- [x] upgrade kubernetes cluster\n- [x] <b>bold</b> & stuff\n', '2026-02-06_sprint.md': '## This Week\n\n- [x] Kubernetes audit\n' };
await test('10 search: all files, case-insens., min length, no match, escaping, open hit, clear restores', { pre: '## Today\n\n- [ ] kubernetes patch\n', archives: ARCH }, async c => {
  const { win } = c;
  await win.fill('#q', 'KUBERNETES'); await win.waitForTimeout(500);
  assert.equal(await win.locator('.hit').count(), 3);
  has(await win.textContent('#pv h2'), '3 matches');
  await win.fill('#q', 'k'); await win.waitForTimeout(500);
  assert.equal(await win.locator('.hit').count(), 3);
  await win.fill('#q', 'zzzzqq'); await win.waitForTimeout(500);
  has(await win.textContent('#pv h2'), '0 matches');
  await win.fill('#q', '<b>'); await win.waitForTimeout(500);
  assert.equal(await win.locator('.hit').count(), 1); assert.equal(await win.locator('.hit b').count(), 0);
  has(await win.textContent('.hit'), '<b>bold</b> & stuff');
  await win.fill('#q', 'audit'); await win.waitForTimeout(500);
  await win.click('.hit');
  await win.waitForFunction(() => document.querySelector('#title').textContent.includes('2026-02-06'));
  assert.equal(await win.inputValue('#q'), 'audit');
  await win.fill('#q', ''); await win.waitForTimeout(500);
  assert.ok(!(await win.textContent('#title')).includes('Search'));
  assert.ok(await win.isVisible(ED));
});

await test('11 persistence across relaunch', async c => {
  await c.win.fill('#add', 'persist me'); await c.win.press('#add', 'Enter'); await c.settle();
  await c.app.close();
  const c2 = await launch({ dir: c.dir, ud: c.ud });
  try { has(await G(c2.win), 'persist me'); } finally { await c2.app.close(); }
});

await test('12 typed edit then app closed immediately is not lost', async c => {
  await S(c.win, '## Today\n\n- [ ] last second', true);
  await c.app.close().catch(() => {});
  has(c.cur(), 'last second');
});

await test('13 external edit to current.md is picked up on window focus', async c => {
  fs.writeFileSync(path.join(c.dir, 'current.md'), '## Today\n\n- [ ] edited elsewhere\n');
  await c.win.evaluate(() => window.dispatchEvent(new Event('focus')));
  await c.win.waitForTimeout(400);
  has(await G(c.win), 'edited elsewhere');
});

await test('14 security: path traversal blocked, HTML inert, no node access', async c => {
  const { win } = c;
  await assert.rejects(win.evaluate(() => window.api.read('../../etc/passwd')));
  await assert.rejects(win.evaluate(() => window.api.write('../evil.md', 'x')));
  await S(win, '<img src=x onerror="window.__x=1"><script>window.__x=2</script>\n', true); await win.waitForTimeout(300);
  assert.equal(await win.locator('.tiptap img').count(), 0);
  has(await win.textContent(ED), '<img src=x');
  assert.equal(await win.evaluate(() => window.__x), undefined);
  assert.deepEqual(await win.evaluate(() => [typeof require, typeof process]), ['undefined', 'undefined']);
});

await test('15 edge: lowercase headings reused, missing section created, CRLF ok', { pre: '## today\r\n\r\n- [x] a\r\n\r\n## THIS WEEK\r\n\r\n- [ ] b\r\n' }, async c => {
  const { win } = c;
  await win.fill('#add', 'new one'); await win.press('#add', 'Enter');
  await win.selectOption('#sec', 'This Month'); await win.fill('#add', 'mm'); await win.press('#add', 'Enter');
  await c.settle();
  const t = c.cur();
  assert.equal((t.match(/^## today/gim) || []).length, 1, t);
  has(t, '## This Month');
  await c.endSprint('#dcarry');
  has(c.read(c.arch()[0]), '- [x] a');
  has(c.cur(), '- [ ] b', 'new one', 'mm');
});

await test('16 edge: nothing to archive / only This Month items / empty file', { pre: 'intro text\n\n## This Month\n\n- [ ] only month\n' }, async c => {
  const before = c.cur();
  await c.win.click('#end'); await c.win.waitForTimeout(400);
  assert.ok(!(await c.win.evaluate(() => document.querySelector('#dlg').open)));
  has(await c.win.textContent('#status'), 'Nothing to archive');
  assert.deepEqual(c.arch(), []); assert.equal(c.cur(), before);
  await S(c.win, '', true); await c.win.fill('#add', 'x'); await c.win.press('#add', 'Enter'); await c.settle();
  has(c.cur(), '## Today', '- [ ] x');
});

await test('17 scale: 3000 tasks open, search and end sprint stay fast', {
  pre: '## Today\n\n' + Array.from({ length: 1500 }, (_, i) => `- [${i % 2 ? 'x' : ' '}] task ${i}\n  - note ${i}\n`).join('') + '\n## This Week\n\n' + Array.from({ length: 1500 }, (_, i) => `- [x] wk ${i}\n`).join('') + '\n## This Month\n'
}, async c => {
  const { win } = c;
  assert.equal(await win.locator(BOX).count(), 3000);
  let t0 = Date.now(); await win.fill('#q', 'task 1499'); await win.waitForSelector('.hit'); const tSearch = Date.now() - t0;
  await win.fill('#q', '');
  t0 = Date.now(); await c.endSprint('#dcarry'); const tEnd = Date.now() - t0;
  assert.ok(tSearch < 2000 && tEnd < 4000, `slow: search ${tSearch}ms end ${tEnd}ms`);
  assert.equal((c.read(c.arch()[0]).match(/^- \[x\]/gm) || []).length, 750 + 1500);
  assert.equal((c.cur().match(/^- \[ \]/gm) || []).length, 750);
  console.log(`   timings: search ${tSearch}ms, end sprint ${tEnd}ms`);
});

const LIVE = '## Heading\n\nsome **bold** and _it_ and `code` and ~~gone~~ and [link](https://x.y)\n\n- plain\n  - nested\n- [x] done item\n\n> quote\n';
await test('18 rich text: no markdown syntax shown, even on the line being edited', { pre: LIVE }, async c => {
  const { win } = c;
  const text = () => win.textContent(ED);
  const check = async () => {
    has(await text(), 'Heading', 'some bold and it and code and gone and link', 'plain', 'nested', 'done item', 'quote');
    lacks(await text(), '##', '**', '_it_', '`', '~~', '](', '[x]', '> ');
  };
  await check();
  assert.ok(parseFloat(await win.locator('.tiptap h2').evaluate(e => getComputedStyle(e).fontSize)) > 20);
  assert.ok(+(await win.locator('.tiptap strong').evaluate(e => getComputedStyle(e).fontWeight)) >= 600);
  assert.equal(await win.locator('.tiptap ul:not([data-type]) > li').count(), 2);
  assert.equal(await win.locator('li[data-checked=true]').count(), 1);
  await win.locator('.tiptap strong').click(); await check();
  await win.locator('.tiptap h2').click(); await check();
  await win.locator('blockquote').click(); await win.keyboard.press('End'); await win.keyboard.type(' more'); await check();
  assert.equal(await G(win), LIVE.replace('_it_', '*it*').replace('> quote', '> quote more'));
});

await test('19 slash menu inserts blocks', async c => {
  const { win } = c;
  const pick = async cmd => { await win.keyboard.type(cmd); await win.waitForSelector('.slash li'); await win.keyboard.press('Enter'); await win.waitForTimeout(100); };
  await S(win, '', true); await win.click(ED);
  await pick('/h2'); await win.keyboard.type('Title'); await win.keyboard.press('Enter');
  await pick('/todo'); await win.keyboard.type('first'); await win.keyboard.press('Enter'); await win.keyboard.press('Enter');
  await pick('/code'); await win.keyboard.type('ls -la'); await win.keyboard.press('Enter'); await win.keyboard.press('Enter'); await win.keyboard.press('Enter');
  await pick('/date');
  const t = await G(win);
  has(t, '## Title\n', '- [ ] first\n', '```\nls -la\n```', today);
  await win.keyboard.type(' https://example.com/h2');
  assert.equal(await win.locator('.slash').count(), 0, 'no menu inside URLs');
  await S(win, '', true); await win.click(ED);
  await win.keyboard.type('/bullet'); await win.waitForSelector('.slash li'); await win.keyboard.press('Tab');
  await win.keyboard.type('picked with Tab');
  assert.equal(await G(win), '- picked with Tab\n');
});

await test('20 toolbar + shortcuts: wrap/unwrap, headings, lists, checklist toggle, code block', { pre: 'hello world\n' }, async c => {
  const { win } = c;
  const btn = n => win.click(`[data-cmd=${n}]`);
  const first = async () => (await G(win)).split('\n')[0];
  await toEnd(win);
  for (let i = 0; i < 5; i++) await win.keyboard.press('Shift+ArrowLeft');
  await btn('bold'); assert.equal(await first(), 'hello **world**');
  await btn('bold'); assert.equal(await first(), 'hello world');
  await win.keyboard.press('Meta+b'); await win.keyboard.press('Meta+i');
  assert.equal(await first(), 'hello ***world***');
  await win.keyboard.press('End'); await win.keyboard.press('Meta+b'); await win.keyboard.press('Meta+i');
  await btn('strike'); await win.keyboard.type('x');
  assert.equal(await first(), 'hello ***world***~~x~~');
  await btn('h1'); assert.equal(await first(), '# hello ***world***~~x~~');
  await btn('h1'); await btn('check'); assert.ok((await G(win)).startsWith('- [ ] hello'));
  await win.keyboard.press('Meta+Enter'); assert.ok((await G(win)).startsWith('- [x] hello'));
  await win.keyboard.press('Meta+Enter'); assert.ok((await G(win)).startsWith('- [ ] hello'));
  await btn('bullet'); assert.ok((await G(win)).startsWith('- hello'), await G(win));
  await btn('number'); assert.ok((await G(win)).startsWith('1. hello'), await G(win));
  await btn('number'); await btn('quote'); assert.ok((await G(win)).startsWith('> hello'), await G(win));
  await btn('quote'); await btn('codeblock'); assert.ok((await G(win)).startsWith('```\nhello'), await G(win));
  await win.keyboard.press('Meta+z'); await win.keyboard.press('Meta+z');
  await c.settle(); has(c.cur(), 'hello');
});

await test('21 natural typing: Ctrl+B bold, Ctrl+T to-do, "* " bullet, Tab indents, no syntax visible', async c => {
  const { win } = c;
  await S(win, '', true); await win.click(ED);
  await win.keyboard.press('Control+t'); await win.keyboard.type('Write report');
  await win.keyboard.press('Enter'); await win.keyboard.type('Gather numbers'); await win.keyboard.press('Tab');
  await win.keyboard.press('Enter'); await win.keyboard.press('Shift+Tab'); await win.keyboard.press('Control+t');
  await win.keyboard.type('Notes: ');
  await win.keyboard.press('Control+b'); await win.keyboard.type('important'); await win.keyboard.press('Control+b');
  await win.keyboard.type(' stuff'); await win.keyboard.press('Enter');
  await win.keyboard.type('* first bullet'); await win.keyboard.press('Enter');
  await win.keyboard.type('second'); await win.keyboard.press('Tab');
  await win.keyboard.press('Enter'); await win.keyboard.press('Shift+Tab'); await win.keyboard.press('Shift+Tab');
  await win.keyboard.type('- dash bullet');
  assert.equal(await G(win), '- [ ] Write report\n  - [ ] Gather numbers\n\nNotes: **important** stuff\n\n- first bullet\n  - second\n- dash bullet\n');
  lacks(await win.textContent(ED), '**', '* ', '[ ]');
  assert.equal(await win.locator(BOX).count(), 2);
  await win.keyboard.press('Control+t');
  assert.ok((await G(win)).endsWith('- [ ] dash bullet\n'), await G(win));
  await win.keyboard.press('Control+t');
  assert.ok((await G(win)).endsWith('\ndash bullet\n'), await G(win));
});

await test('22 layout: a new to-do keeps the checkbox and the caret on the same line', async c => {
  const { win } = c;
  const geometry = () => win.evaluate(() => {
    const sel = getSelection(), li = sel.anchorNode.parentElement.closest('li');
    const box = li.querySelector(':scope > label > input').getBoundingClientRect();
    const caret = sel.getRangeAt(0).getClientRects()[0] || sel.anchorNode.parentElement.getBoundingClientRect();
    return { boxMid: box.top + box.height / 2, caretTop: caret.top, caretBottom: caret.bottom, boxRight: box.right, caretLeft: caret.left };
  });
  const ways = {
    'Ctrl+T on an empty line': () => win.keyboard.press('Control+t'),
    'Meta+T on an empty line': () => win.keyboard.press('Meta+t'),
    '[] shortcut': () => win.keyboard.type('[] '),
    'toolbar button': () => win.click('[data-cmd=check]'),
    'slash menu': async () => { await win.keyboard.type('/todo'); await win.waitForSelector('.slash li'); await win.keyboard.press('Enter'); },
    'Enter after an existing to-do': async () => { await win.keyboard.press('Control+t'); await win.keyboard.type('first'); await win.keyboard.press('Enter'); }
  };
  for (const [name, create] of Object.entries(ways)) {
    await S(win, '## Today\n', true); await toEnd(win); await win.keyboard.press('Enter');
    await create(); await win.keyboard.type('typed');
    const g = await geometry();
    assert.ok(g.boxMid > g.caretTop && g.boxMid < g.caretBottom, `${name}: checkbox is not on the caret's line ${JSON.stringify(g)}`);
    assert.ok(g.caretLeft > g.boxRight, `${name}: caret is not to the right of the checkbox ${JSON.stringify(g)}`);
    assert.ok((await G(win)).endsWith('- [ ] typed\n'), `${name}: ${JSON.stringify(await G(win))}`);
  }
});

await test('23 Tab indents bullets, to-dos, headings and paragraphs under the item above', async c => {
  const { win } = c;
  const cases = [
    ['- [ ] task\n\n- bullet\n', 'bullet', '- [ ] task\n\n  - bullet\n'],
    ['- bullet\n- [ ] task\n', 'task', '- bullet\n  - [ ] task\n'],
    ['- [ ] task\n\n### Heading\n', 'Heading', '- [ ] task\n\n  ### Heading\n'],
    ['- [ ] task\n\nnotes\n', 'notes', '- [ ] task\n\n  notes\n']
  ];
  for (const [md, line, expected] of cases) {
    await S(win, md, true);
    await win.locator('.tiptap :is(p,h3)', { hasText: new RegExp('^' + line + '$') }).click(); await win.keyboard.press('End');
    const leftBefore = await win.locator('.tiptap :is(p,h3)', { hasText: new RegExp('^' + line + '$') }).evaluate(e => e.getBoundingClientRect().left);
    await win.keyboard.press('Tab');
    assert.equal(await G(win), expected);
    const leftAfter = await win.locator('.tiptap :is(p,h3)', { hasText: new RegExp('^' + line + '$') }).evaluate(e => e.getBoundingClientRect().left);
    assert.ok(leftAfter > leftBefore + 10, `${line}: not visibly indented (${leftBefore} -> ${leftAfter})`);
    await win.keyboard.type('!');
    has(await G(win), line + '!');
    await win.keyboard.press('Shift+Tab');
    assert.ok(!(await G(win)).includes('  '), `${line}: Shift+Tab did not outdent: ${JSON.stringify(await G(win))}`);
  }
});

await test('24 Tab and Shift+Tab move text sideways only, never up or down', async c => {
  const { win } = c;
  const cases = [
    ['- [ ] task\n\n- bullet\n\nnext line\n', 'bullet'],
    ['- bullet\n- [ ] task\n\nnext line\n', 'task'],
    ['- [ ] task\n\n### Heading\n\nnext line\n', 'Heading'],
    ['- [ ] task\n\nnotes\n\nnext line\n', 'notes'],
    ['- [ ] a\n  - [ ] b\n- [ ] c\n\nnext line\n', 'c'],
    ['- one\n- two\n\nnext line\n', 'two'],
    ['- [ ] one\n- [ ] two\n\nnext line\n', 'two']
  ];
  const tops = () => win.evaluate(() => [...document.querySelectorAll('.tiptap :is(p,h1,h2,h3)')].map(e => [e.textContent, Math.round(e.getBoundingClientRect().top * 10) / 10]));
  const errors = [];
  for (const [md, line] of cases) {
    await S(win, md, true);
    await win.locator('.tiptap :is(p,h3)', { hasText: new RegExp('^' + line + '$') }).click(); await win.keyboard.press('End');
    const before = await tops();
    for (const key of ['Tab', 'Shift+Tab']) {
      const start = await tops();
      await win.keyboard.press(key);
      const end = await tops();
      if (JSON.stringify(start) !== JSON.stringify(end)) errors.push(`${key} on "${line}": ${JSON.stringify(start)} -> ${JSON.stringify(end)}`);
    }
    if (JSON.stringify(before) !== JSON.stringify(await tops())) errors.push(`"${line}" did not return to its start position`);
  }
  if (errors.length) console.log(errors.join("\n"));
  assert.deepEqual(errors, []);
});

const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString('en-CA'); };
const EXPORT_ARCH = {
  [`${daysAgo(800)}_sprint.md`]: '# Sprint ended old\n\n## Today\n\n- [x] ancient task\n',
  [`${daysAgo(30)}_sprint.md`]: '# Sprint ended recent\n\n## Today\n\n- [x] recent one\n',
  [`${daysAgo(30)}_sprint-2.md`]: '# Sprint ended recent 2\n\n## Today\n\n- [x] recent two\n'
};
await test('25 export: ranges, single sprint, unsaved edits included, cancel writes nothing', { pre: '## Today\n\n- [ ] current task\n', archives: EXPORT_ARCH }, async c => {
  const { win, app } = c;
  const out = path.join(c.dir, '..', path.basename(c.dir) + '-export.md');
  const stubSave = canceled => app.evaluate(({ dialog }, [file, canceled]) => {
    global.__saveOpts = null;
    dialog.showSaveDialog = async (w, o) => { global.__saveOpts = o; return canceled ? { canceled: true } : { canceled: false, filePath: file }; };
  }, [out, canceled]);
  const exportAs = async value => {
    await win.click('#export'); await win.waitForSelector('#exportdlg[open]');
    if (value) await win.selectOption('#exsel', value);
    await win.click('#exportdlg button[value=ok]');
    await win.waitForFunction(() => !document.querySelector('#exportdlg').open);
    await win.waitForTimeout(400);
  };

  await stubSave(false);
  await S(win, '## Today\n\n- [ ] current task\n- [ ] typed just now\n', true);
  await win.click('#export'); await win.waitForSelector('#exportdlg[open]');
  const options = await win.$$eval('#exsel option', os => os.map(o => o.value));
  assert.deepEqual(options.slice(0, 4), ['current', 'months:6', 'months:12', 'all']);
  assert.equal(options.length, 7);
  assert.equal(await win.inputValue('#exsel'), 'current');
  await win.click('#exportdlg button[value=cancel]');

  await exportAs('months:6');
  const six = fs.readFileSync(out, 'utf8');
  has(six, '# Sprint notes: last 6 months', 'recent one', 'recent two', 'current task', 'typed just now');
  lacks(six, 'ancient task');
  assert.ok(six.indexOf('recent one') < six.indexOf('recent two') && six.indexOf('recent two') < six.indexOf('current task'), six);
  assert.ok((await app.evaluate(() => global.__saveOpts.defaultPath)).endsWith(`sprint-notes_last-6-months_${today}.md`));
  has(await win.textContent('#status'), 'Exported 3 files');

  await exportAs('all');
  has(fs.readFileSync(out, 'utf8'), 'ancient task', 'recent one', 'current task');

  await win.click(`#arch li[data-f="archive/${daysAgo(30)}_sprint-2.md"]`);
  await win.waitForFunction(() => document.querySelector('#title').textContent.includes('read-only'));
  await exportAs(null);
  const one = fs.readFileSync(out, 'utf8');
  has(one, 'recent two'); lacks(one, 'recent one', 'current task');

  fs.unlinkSync(out);
  await stubSave(true);
  await exportAs('all');
  assert.equal(fs.existsSync(out), false);
});

const FOLD = '## Today\n\n- [ ] alpha\n- [ ] bravo task\n\n## This Week\n\n- [ ] weekly\n\n## This Month\n\n- [ ] monthly\n';
await test('26 folding: hide a section, persists per file, never edits the file, quick add/search/end sprint still work', { pre: FOLD, archives: { '2026-01-09_sprint.md': '# Sprint ended 2026-01-09\n\n## Today\n\n- [x] old\n' } }, async c => {
  const { win } = c;
  const visible = t => win.locator('.tiptap li', { hasText: t }).isVisible();
  await win.locator('.fold-toggle').first().click();
  assert.equal(await visible('alpha'), false);
  assert.equal(await visible('weekly'), true);
  has(await win.textContent('.fold-count'), '2 hidden');
  await c.settle();
  assert.equal(c.cur(), FOLD, 'folding must not rewrite the file');

  await c.app.close();
  const c2 = await launch({ dir: c.dir, ud: c.ud });
  try {
    const w = c2.win, vis = t => w.locator('.tiptap li', { hasText: t }).isVisible();
    assert.equal(await vis('alpha'), false, 'fold state should survive a relaunch');

    await w.fill('#add', 'added while folded'); await w.press('#add', 'Enter'); await c2.settle();
    has(c2.cur(), '- [ ] added while folded');
    has(await w.textContent('#status'), 'Added to Today (folded)');
    assert.equal(await vis('added while folded'), false);

    await w.click('#arch li[data-f]');
    await w.waitForFunction(() => document.querySelector('#title').textContent.includes('read-only'));
    assert.equal(await vis('old'), true, 'folds are per file');

    await w.fill('#q', 'bravo'); await w.waitForSelector('.hit');
    await w.locator('.hit', { hasText: 'bravo' }).click();
    await w.waitForFunction(() => document.querySelector('#title').textContent === 'Current sprint');
    assert.equal(await vis('bravo task'), true, 'opening a search hit unfolds');
    await w.click('#curnav'); await w.waitForTimeout(200);
    assert.equal(await vis('bravo task'), false, 'the saved fold state is unchanged by a search');

    await c2.endSprint('#darch');
    has(c2.read(c2.arch().find(n => n.startsWith(today))), 'alpha _(not done)_', 'weekly _(not done)_');

    await w.locator('.fold-toggle').first().click();
    assert.equal(await w.locator('.fold-hidden').count(), 0);
  } finally { await c2.app.close(); }
});

await test('27 archive right-click: rename, move to Trash, make current sprint; Enter confirms dialogs', {
  pre: '## Today\n\n- [ ] new today\n\n## This Week\n\n## This Month\n\n- [ ] M\n',
  archives: {
    '2026-10-23_sprint.md': '# Sprint ended 2026-10-23\n\n## Today\n\n- [x] shipped A\n  - note A\n- [ ] open B _(not done)_\n\n## This Week\n\n- [x] weekly W\n',
    '2026-10-23_sprint-2.md': '# Sprint ended 2026-10-23\n\n## Today\n\n- [x] second\n',
    '2026-11-06_sprint.md': '# Sprint ended 2026-11-06\n\n## Today\n\n- [x] newest\n'
  }
}, async c => {
  const { win, app } = c;
  const trash = fs.mkdtempSync(path.join(os.tmpdir(), 'trash-'));
  await app.evaluate(({ ipcMain, shell }, trash) => {
    const fs = process.getBuiltinModule('fs'), path = process.getBuiltinModule('path');
    global.__menu = [];
    ipcMain.removeHandler('archiveMenu');
    ipcMain.handle('archiveMenu', () => global.__menu.shift() ?? null);
    shell.trashItem = async p => fs.renameSync(p, path.join(trash, path.basename(p)));
  }, trash);
  const menu = (action, li) => app.evaluate((_, a) => global.__menu.push(a), action).then(() => win.locator('#arch li', { hasText: li }).first().click({ button: 'right' }));
  const names = () => win.$$eval('#arch li', ls => ls.map(l => l.textContent));
  const confirm = async () => { await win.waitForSelector('#confirmdlg[open]'); await win.click('#cok'); await win.waitForFunction(() => !document.querySelector('#confirmdlg').open); await win.waitForTimeout(300); };

  assert.deepEqual(await names(), ['2026-11-06', '2026-10-23-2', '2026-10-23']);

  await win.click('#arch li >> text=2026-10-23-2');
  await win.waitForFunction(() => document.querySelector('#title').textContent.includes('read-only'));
  await menu('rename', '2026-10-23-2');
  await win.waitForSelector('#renamedlg[open]');
  assert.equal(await win.inputValue('#rname'), 'sprint-2');
  await win.fill('#rname', 'sprint'); await win.press('#rname', 'Enter');
  has(await win.textContent('#rerr'), 'already has that name');
  await win.fill('#rname', '../x'); await win.press('#rname', 'Enter');
  has(await win.textContent('#rerr'), 'can’t contain');
  await win.fill('#rname', 'Launch week'); await win.press('#rname', 'Enter');
  await win.waitForFunction(() => !document.querySelector('#renamedlg').open); await win.waitForTimeout(300);
  assert.deepEqual(c.arch(), ['2026-10-23_Launch week.md', '2026-10-23_sprint.md', '2026-11-06_sprint.md']);
  assert.deepEqual(await names(), ['2026-11-06', '2026-10-23', '2026-10-23 · Launch week']);
  has(await win.textContent('#title'), 'Launch week');

  await menu('rename', 'Launch week');
  await win.waitForSelector('#renamedlg[open]');
  await win.fill('#rname', 'not applied'); await win.click('#renamedlg button[value=cancel]');
  await win.waitForTimeout(200);
  assert.ok(c.arch().includes('2026-10-23_Launch week.md'));

  await menu('delete', 'Launch week');
  await win.waitForSelector('#confirmdlg[open]');
  await win.click('#confirmdlg button[value=cancel]'); await win.waitForTimeout(200);
  assert.equal(c.arch().length, 3);
  await menu('delete', 'Launch week'); await confirm();
  assert.deepEqual(c.arch(), ['2026-10-23_sprint.md', '2026-11-06_sprint.md']);
  assert.ok(fs.existsSync(path.join(trash, '2026-10-23_Launch week.md')), 'deleted sprint goes to the Trash');
  assert.equal(await win.textContent('#title'), 'Current sprint', 'deleting the open sprint returns to the current sprint');

  await S(win, '## Today\n\n- [ ] new today\n- [ ] unsaved edit\n\n## This Week\n\n## This Month\n\n- [ ] M\n', true);
  await menu('restore', '2026-10-23'); await confirm();
  assert.equal(c.cur(), '## Today\n\n- [x] shipped A\n  - note A\n- [ ] open B\n- [ ] new today\n- [ ] unsaved edit\n\n## This Week\n\n- [x] weekly W\n\n## This Month\n\n- [ ] M\n');
  assert.deepEqual(c.arch(), ['2026-11-06_sprint.md']);
  assert.ok(fs.existsSync(path.join(trash, '2026-10-23_sprint.md')));
  has(await G(win), 'shipped A', 'unsaved edit');
  assert.deepEqual(await names(), ['2026-11-06']);
});

await test('28 ⌘N jumps to quick add on the current sprint from anywhere', { pre: '## Today\n\n- [ ] a\n', archives: { '2026-01-09_sprint.md': '# Sprint ended 2026-01-09\n\n## Today\n\n- [x] old\n' } }, async c => {
  const { win } = c;
  const focused = () => win.evaluate(() => document.activeElement.id);
  await win.click(ED); await win.keyboard.press('Meta+n');
  assert.equal(await focused(), 'add');
  await win.keyboard.type('from editor'); await win.keyboard.press('Enter');
  await win.keyboard.press('Escape');
  await win.waitForFunction(() => document.activeElement.classList.contains('tiptap'), null, { timeout: 2000 });

  await win.click('#arch li[data-f]');
  await win.waitForFunction(() => document.querySelector('#title').textContent.includes('read-only'));
  await win.keyboard.press('Meta+n');
  await win.waitForFunction(() => document.querySelector('#title').textContent === 'Current sprint');
  assert.equal(await focused(), 'add');

  await win.fill('#q', 'old'); await win.waitForSelector('.hit');
  await win.keyboard.press('Meta+n');
  await win.waitForFunction(() => document.querySelector('#title').textContent === 'Current sprint');
  assert.ok(await win.isVisible(ED));
  assert.equal(await focused(), 'add');
  await win.keyboard.type('from search'); await win.keyboard.press('Enter'); await c.settle();
  has(c.cur(), '- [ ] from editor', '- [ ] from search');

  await win.click('#export'); await win.waitForSelector('#exportdlg[open]');
  await win.keyboard.press('Meta+n');
  assert.equal(await win.evaluate(() => document.querySelector('#exportdlg').open), true, 'ignored while a dialog is open');
});

await test('29 Jira links: settings dialog validates, saves, links keys, survives relaunch', { pre: '## Today\n\n- [ ] Fix RA-12 and UTF-8 handling\n' }, async c => {
  const { win, app } = c;
  await app.evaluate(({ shell }) => { global.__opened = []; shell.openExternal = u => { global.__opened.push(u); return Promise.resolve(); }; });
  assert.equal(await win.locator('.jira-link').count(), 0);
  const save = async (base, keys) => {
    await win.click('#settings'); await win.waitForSelector('#settingsdlg[open]');
    await win.fill('#jbase', base); await win.fill('#jkeys', keys); await win.press('#jkeys', 'Enter');
  };
  await save('javascript:alert(1)', '');
  has(await win.textContent('#serr'), 'web address');
  await win.fill('#jbase', 'acme.atlassian.net/browse/RA-1'); await win.fill('#jkeys', 'ra, 9x'); await win.press('#jkeys', 'Enter');
  has(await win.textContent('#serr'), '9X');
  await win.fill('#jkeys', 'ra'); await win.press('#jkeys', 'Enter');
  await win.waitForFunction(() => !document.querySelector('#settingsdlg').open);
  await win.waitForSelector('.jira-link');
  assert.deepEqual(await win.$$eval('.jira-link', ls => ls.map(l => l.textContent)), ['RA-12']);
  await win.locator('.jira-link').click(); await win.waitForTimeout(200);
  assert.deepEqual(await app.evaluate(() => global.__opened), ['https://acme.atlassian.net/browse/RA-12']);
  await c.settle();
  assert.equal(c.cur(), '## Today\n\n- [ ] Fix RA-12 and UTF-8 handling\n', 'links are view-only');
  const cfg = JSON.parse(fs.readFileSync(path.join(c.ud, 'config.json'), 'utf8'));
  assert.deepEqual([cfg.root, cfg.jiraBase, cfg.jiraKeys], [c.dir, 'https://acme.atlassian.net', ['RA']]);

  await c.app.close();
  const c2 = await launch({ dir: c.dir, ud: c.ud });
  try {
    await c2.win.waitForSelector('.jira-link');
    assert.equal(await c2.win.locator('.jira-link').count(), 1);
  } finally { await c2.app.close(); }
});

const readCfg = c => JSON.parse(fs.readFileSync(path.join(c.ud, 'config.json'), 'utf8'));
const addDaysIso = (n, from = new Date()) => { const d = new Date(from); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
await test('30 auto end sprint: off by default, checkbox saves a future date, ends a due sprint on launch and schedules the next', { pre: MIX }, async c => {
  const { win } = c;
  assert.equal(await win.isChecked('#autoon'), false);
  assert.equal(await win.inputValue('#autodate'), addDaysIso(14), 'defaults to one sprint from today');
  await win.check('#autoon'); await win.waitForTimeout(300);
  assert.deepEqual([readCfg(c).autoEnd, readCfg(c).autoEndDate], [true, addDaysIso(14)]);
  assert.deepEqual(c.arch(), [], 'a future date does not end the sprint');
  await win.fill('#autodate', addDaysIso(-3)); await win.waitForTimeout(300);
  has(await win.textContent('#status'), 'after today');
  assert.equal(readCfg(c).autoEndDate, addDaysIso(14), 'past dates are refused');
  await win.fill('#autodate', addDaysIso(5)); await win.waitForTimeout(300);
  assert.equal(readCfg(c).autoEndDate, addDaysIso(5));
  await win.uncheck('#autoon'); await win.waitForTimeout(300);
  assert.equal(readCfg(c).autoEnd, false);
  await c.app.close();

  const c2 = await launch({ dir: c.dir, ud: c.ud, config: { autoEnd: true, autoEndDate: addDaysIso(-1), sprintWeeks: 2 }, archives: { '2026-01-09_sprint.md': '# old\n' } });
  try {
    await c2.win.waitForFunction(() => document.querySelector('#status').textContent.includes('automatically'), null, { timeout: 5000 });
    const archived = c2.arch().find(n => n.startsWith(today));
    assert.ok(archived, 'the due sprint was archived');
    has(c2.read(archived), 'done A', 'done D'); lacks(c2.read(archived), 'open B');
    has(c2.cur(), '- [ ] open B', '- [ ] open C', '- [ ] M');
    lacks(c2.cur(), 'done A');
    assert.equal(readCfg(c2).autoEndDate, addDaysIso(13), 'next date is one sprint after the previous one');
    assert.equal(await c2.win.inputValue('#autodate'), addDaysIso(13));
    await c2.win.evaluate(() => window.dispatchEvent(new Event('focus'))); await c2.win.waitForTimeout(400);
    assert.equal(c2.arch().filter(n => n.startsWith(today)).length, 1, 'does not run twice');
  } finally { await c2.app.close(); }
});

await test('31 settings: colour mode, accent presets, advanced overrides; preview, cancel, reset, relaunch', async c => {
  const { win } = c;
  const cssVar = n => win.evaluate(n => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), n);
  const bodyBg = () => win.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const open = async w => { await w.click('#settings'); await w.waitForSelector('#settingsdlg[open]'); };
  const checked = sel => win.$$eval(`${sel} [aria-checked=true]`, bs => bs.map(b => b.textContent.trim()));

  await open(win);
  assert.equal(await win.inputValue('#sweeks'), '2');
  assert.deepEqual(await checked('#modes'), ['Dark']);
  assert.deepEqual(await checked('#presets'), ['Blue']);
  assert.equal(await win.locator('#presets button').count(), 5);
  assert.equal(await win.$eval('#advanced', d => d.open), false, 'advanced colours start collapsed');

  await win.click('#modes [data-mode=light]');
  assert.equal(await bodyBg(), 'rgb(247, 247, 248)', 'previews light mode');
  await win.click('#presets [data-preset=green]');
  assert.equal(await cssVar('--accent'), '#12784f', 'uses the light shade of the preset');
  await win.click('#settingsdlg button[value=cancel]'); await win.waitForTimeout(200);
  assert.equal(await bodyBg(), 'rgb(28, 28, 30)', 'cancel restores');
  assert.equal(await cssVar('--accent'), '#4aa3ff');
  assert.equal(readCfg(c).themeMode, undefined);

  await open(win);
  await win.selectOption('#sweeks', '3');
  await win.click('#modes [data-mode=light]'); await win.click('#presets [data-preset=purple]');
  await win.click('#advanced summary');
  await win.$eval('#color-side', el => { el.value = '#ffe9a8'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  has(await win.textContent('#colors'), 'Sidebar •');
  await win.click('#settingsdlg button[value=ok]'); await win.waitForTimeout(300);
  const cfg = readCfg(c);
  assert.deepEqual([cfg.sprintWeeks, cfg.themeMode, cfg.themePreset, cfg.themeOverrides, cfg.windowBg], [3, 'light', 'purple', { side: '#ffe9a8' }, '#f7f7f8']);
  assert.equal(await cssVar('--accent'), '#6e3fe0');
  assert.equal(await win.evaluate(() => getComputedStyle(document.querySelector('aside')).backgroundColor), 'rgb(255, 233, 168)');
  assert.equal(await win.inputValue('#autodate'), addDaysIso(21), 'auto end default follows the sprint length');

  await c.app.close();
  const c2 = await launch({ dir: c.dir, ud: c.ud });
  try {
    const w = c2.win;
    assert.equal(await w.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(247, 247, 248)', 'theme survives relaunch');
    await open(w);
    assert.equal(await w.$eval('#advanced', d => d.open), true, 'advanced opens when there are overrides');
    await w.click('#resetcolors');
    await w.click('#modes [data-mode=dark]'); await w.click('#presets [data-preset=blue]');
    await w.click('#settingsdlg button[value=ok]'); await w.waitForTimeout(300);
    assert.deepEqual([readCfg(c2).themeMode, readCfg(c2).themeOverrides], ['dark', {}]);
    assert.equal(await w.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(28, 28, 30)');
  } finally { await c2.app.close(); }
});

await test('32 header: Export is an icon button with an accessible name; auto end hides on archives', { archives: { '2026-01-09_sprint.md': '# old\n' } }, async c => {
  const { win } = c;
  assert.equal(await win.getAttribute('#export', 'aria-label'), 'Export');
  assert.equal((await win.textContent('#export')).trim(), '');
  assert.equal(await win.locator('#export svg').count(), 1);
  assert.ok(await win.isVisible('#autoend'));
  await win.click('#arch li[data-f]');
  await win.waitForFunction(() => document.querySelector('#title').textContent.includes('read-only'));
  assert.ok(await win.isHidden('#autoend'));
  assert.ok(await win.isVisible('#export'));
});

await test('33 pasting a Jira issue URL shows just the key', { pre: '## Today\n\n- [ ] review\n' }, async c => {
  const { win, app } = c;
  await app.evaluate(({ clipboard }) => clipboard.writeText('https://animoto.atlassian.net/browse/RA-483'));
  await win.locator('.tiptap li', { hasText: 'review' }).click(); await win.keyboard.press('End');
  await win.keyboard.type(' '); await win.keyboard.press('Meta+v'); await win.keyboard.type(' next');
  assert.equal(await win.locator('.tiptap a').textContent(), 'RA-483');
  await c.settle();
  has(c.cur(), '- [ ] review [RA-483](https://animoto.atlassian.net/browse/RA-483) next');
});

await test('34 ⌘N quick add with a pasted Jira URL shows just the key', async c => {
  const { win, app } = c;
  await app.evaluate(({ clipboard }) => clipboard.writeText('https://animoto.atlassian.net/browse/RA-483'));
  await win.click(ED); await win.keyboard.press('Meta+n');
  await win.keyboard.type('Review '); await win.keyboard.press('Meta+v'); await win.keyboard.press('Enter');
  await c.settle();
  assert.deepEqual(await win.$$eval('.tiptap a', as => as.map(a => a.textContent)), ['RA-483']);
  has(c.cur(), '- [ ] Review [RA-483](https://animoto.atlassian.net/browse/RA-483)');
});

console.log('\n' + results.map(r => `${r[0]}  ${r[1]}${r[2] ? '\n      ' + r[2] : ''}`).join('\n'));
const f = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - f}/${results.length} passed`);
process.exit(f ? 1 : 0);
})();
