import { createEditor } from './editor.js';
import { addTask, countSprintTasks, endSprint, restoreSprint } from './sprint.js';
import { RANGES, pickFiles, buildExport, exportTitle, exportFileName } from './export.js';
import { sortArchives, archiveDisplayName, archiveLabel, renamedArchive } from './archive.js';
import { normalizeJiraBase, parseProjectKeys, shortenIssueUrls } from './jira.js';
import { THEME, PRESETS, withDefaults, resolveTheme, themeVars, readableOn, isIsoDate } from './settings.js';
import { addDays, defaultAutoEndDate, isAutoEndDue, nextAutoEndDate } from './schedule.js';
const $ = s => document.querySelector(s);
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// disk: last text read from or written to current.md. The editor normalises markdown on output, so external
// edits are detected against this rather than against ui.get().
let curTitle = '', file = 'current.md', timer = null, searching = false, disk = null, settings = withDefaults();
const today = () => new Date().toLocaleDateString('en-CA');
const isCur = () => file === 'current.md';
const ui = createEditor({
  parent: $('#editor'),
  onChange: () => { $('#status').textContent = 'Saving…'; clearTimeout(timer); timer = setTimeout(save, 500); },
  onOpen: u => api.open(u),
  askLink,
  onFoldChange: names => { if (!restoringFolds) storeFolds(file, names); }
});
window.__editor = ui;

/* Folded sections are a per-file view preference, so they live in localStorage rather than in the notes. */
let restoringFolds = false;
const foldKey = f => 'folded:' + f;
function storeFolds(f, names) { try { localStorage.setItem(foldKey(f), JSON.stringify(names)); } catch {} }
function loadFolds(f) { try { return JSON.parse(localStorage.getItem(foldKey(f))) || []; } catch { return []; } }
function applyFolds(names) { restoringFolds = true; try { ui.setFolded(names); } finally { restoringFolds = false; } }

function askLink() {
  const dg = $('#linkdlg');
  $('#linkurl').value = ''; dg.returnValue = ''; dg.showModal(); $('#linkurl').focus();
  return new Promise(res => (dg.onclose = () => res(dg.returnValue === 'ok' ? $('#linkurl').value.trim() : '')));
}

async function boot() {
  const root = await api.init();
  if (!root) { document.body.textContent = 'No notes folder chosen. Restart the app to pick one.'; return; }
  $('#folder').textContent = '📁 ' + root.split('/').pop();
  settings = withDefaults(await api.getSettings());
  applyTheme(currentTheme());
  ui.setJira({ base: settings.jiraBase, keys: settings.jiraKeys });
  renderAutoEnd();
  await openFile('current.md');
  await refreshArchives();
  await checkAutoEnd();
  setInterval(checkAutoEnd, 60_000);
}
async function refreshArchives() {
  const a = await api.archives();
  $('#arch').innerHTML = a.length
    ? sortArchives(a).reverse().map(n => `<li data-f="archive/${esc(n)}" title="Right-click for more">${esc(archiveDisplayName(n))}</li>`).join('')
    : '<li class="empty">No sprints archived yet</li>';
  mark();
}
function mark() { document.querySelectorAll('.nav li[data-f]').forEach(li => li.classList.toggle('on', !searching && li.dataset.f === file)); }
function showEditor() { $('#editor').hidden = false; $('#pv').hidden = true; }

async function save() {
  clearTimeout(timer); timer = null;
  if (!isCur()) return;
  const text = ui.get();
  await api.write('current.md', text);
  disk = text;
  $('#status').textContent = 'Saved';
}
async function openFile(f, query, { focusEditor = true } = {}) {
  if (timer) await save();
  searching = false; $('#q').value = query || '';
  file = f; const text = await api.read(f); if (isCur()) disk = text;
  ui.set(text); ui.setReadOnly(!isCur());
  applyFolds(query ? [] : loadFolds(f)); // a search hit may be inside a folded section
  curTitle = isCur() ? 'Current sprint' : archiveDisplayName(f) + ' (archived, read-only)';
  $('#title').textContent = curTitle;
  $('#bar').hidden = $('#fmt').hidden = $('#end').hidden = $('#autoend').hidden = !isCur();
  showEditor(); mark();
  if (isCur() && !query && focusEditor) ui.focus();
  if (query) setTimeout(() => window.find(query), 50);
}
function changed(text) { ui.set(text); return save(); }

/* toolbar */
$('#fmt').addEventListener('mousedown', e => e.preventDefault());
$('#fmt').addEventListener('click', e => { const b = e.target.closest('[data-cmd]'); if (b) ui.run(b.dataset.cmd); });

$('#add').addEventListener('keydown', async e => {
  if (e.key !== 'Enter' || !e.target.value.trim()) return;
  const sec = $('#sec').value;
  const task = shortenIssueUrls(e.target.value.trim()); e.target.value = '';
  await changed(addTask(ui.get(), task, sec));
  if (ui.folded().includes(sec.toLowerCase())) $('#status').textContent = `Added to ${sec} (folded)`;
});

/* end sprint */
function ask(done, open) {
  const dg = $('#dlg');
  $('#dmsg').textContent = open
    ? `${open} unfinished task${open > 1 ? 's' : ''} in Today and This Week. Carry ${open > 1 ? 'them' : 'it'} over to the next sprint, or archive ${open > 1 ? 'them' : 'it'} as not done? (${done} completed will be archived.)`
    : `Archive ${done} completed task${done > 1 ? 's' : ''} and clear Today and This Week?`;
  $('#darch').hidden = !open; $('#dcarry').hidden = false; $('#dcarry').textContent = open ? 'Carry over' : 'Archive';
  dg.returnValue = ''; dg.showModal();
  return new Promise(res => (dg.onclose = () => res(dg.returnValue)));
}
/**
 * Archive Today and This Week of current.md, whether or not it is the file on screen.
 * @returns {Promise<{done: number, open: number, total: number} | null>} task counts, or null when there was nothing to archive
 */
async function performEndSprint({ carry }) {
  if (timer) await save();
  const text = isCur() ? ui.get() : await api.read('current.md');
  const counts = countSprintTasks(text);
  if (!counts.total) return null;
  const date = today();
  const { archive, current } = endSprint(text, { carry: carry && counts.open > 0, date });
  await api.archiveWrite(`${date}_sprint`, archive);
  if (isCur()) await changed(current);
  else { await api.write('current.md', current); disk = current; }
  await refreshArchives();
  return counts;
}
async function onEndSprint() {
  const { done, open, total } = countSprintTasks(ui.get());
  if (!total) { $('#status').textContent = 'Nothing to archive'; return; }
  const choice = await ask(done, open);
  if (!choice || choice === 'cancel') return;
  await performEndSprint({ carry: choice === 'carry' });
  $('#status').textContent = 'Sprint archived';
}
$('#end').onclick = onEndSprint;

/* export */
async function onExport() {
  if (timer) await save();
  const archives = await api.archives();
  const today = new Date().toLocaleDateString('en-CA');
  const sel = $('#exsel');
  sel.innerHTML = RANGES.map(r => `<option value="${r.id}">${esc(r.label)}</option>`).join('') +
    (archives.length ? `<optgroup label="One archived sprint">${sortArchives(archives).reverse().map(n => `<option value="archive/${esc(n)}">${esc(archiveDisplayName(n))}</option>`).join('')}</optgroup>` : '');
  sel.value = isCur() ? 'current' : file;
  const dg = $('#exportdlg');
  dg.returnValue = ''; dg.showModal();
  const ok = await new Promise(res => (dg.onclose = () => res(dg.returnValue === 'ok')));
  if (!ok) return;
  const choice = sel.value;
  const files = pickFiles(choice, archives, today);
  const entries = await Promise.all(files.map(async f => ({ file: f, text: await api.read(f) })));
  const saved = await api.saveExport(exportFileName(choice, today), buildExport(entries, { title: exportTitle(choice, today), today }));
  if (saved) $('#status').textContent = `Exported ${files.length} file${files.length > 1 ? 's' : ''} to ${saved.split('/').pop()}`;
}
$('#export').onclick = onExport;

// Enter in a dialog's text box would submit with the form's first button, which is Cancel. Use the primary one.
document.querySelectorAll('dialog input').forEach(input => input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); input.form.querySelector('button.primary').click(); }
}));

/* auto end sprint */
async function saveSettings(partial) {
  await api.setSettings(partial);
  settings = withDefaults({ ...settings, ...partial });
}
function renderAutoEnd() {
  $('#autoon').checked = settings.autoEnd;
  $('#autodate').value = settings.autoEndDate || defaultAutoEndDate(today(), settings.sprintWeeks);
  $('#autodate').min = addDays(today(), 1);
}
$('#autoon').onchange = async e => {
  let date = $('#autodate').value;
  // A date that has already come would end the sprint the moment the box is ticked.
  if (!isIsoDate(date) || date <= today()) date = defaultAutoEndDate(today(), settings.sprintWeeks);
  await saveSettings({ autoEnd: e.target.checked, autoEndDate: date });
  renderAutoEnd();
  $('#status').textContent = settings.autoEnd ? `Sprint will end automatically on ${date}` : 'Auto end off';
};
$('#autodate').onchange = async e => {
  const date = e.target.value;
  if (!isIsoDate(date) || date <= today()) { renderAutoEnd(); $('#status').textContent = 'Pick a date after today'; return; }
  await saveSettings({ autoEndDate: date });
  if (settings.autoEnd) $('#status').textContent = `Sprint will end automatically on ${date}`;
};
let autoEnding = false;
/** Runs on launch, every minute and on window focus. Unfinished tasks carry over, as there's no one to ask. */
async function checkAutoEnd() {
  if (autoEnding || !isAutoEndDue(settings, today()) || document.querySelector('dialog[open]')) return;
  autoEnding = true;
  try {
    const counts = await performEndSprint({ carry: true });
    const next = nextAutoEndDate(settings.autoEndDate, today(), settings.sprintWeeks);
    await saveSettings({ autoEndDate: next });
    renderAutoEnd();
    $('#status').textContent = counts ? `Sprint ended automatically · next on ${next}` : `Nothing to archive · next auto end on ${next}`;
  } finally { autoEnding = false; }
}

/* settings */
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
const currentTheme = (t = settings) => resolveTheme(t, systemDark.matches);
function applyTheme(theme) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(themeVars(theme))) root.style.setProperty(k, v);
  root.style.colorScheme = readableOn(theme.bg) === '#ffffff' ? 'dark' : 'light';
}
// System mode follows macOS live; the dialog's draft takes over while it's open.
systemDark.addEventListener('change', () => { if (!$('#settingsdlg').open) applyTheme(currentTheme()); });

async function onSettings() {
  const dg = $('#settingsdlg');
  const draft = { themeMode: settings.themeMode, themePreset: settings.themePreset, themeOverrides: { ...settings.themeOverrides } };
  $('#jbase').value = settings.jiraBase; $('#jkeys').value = settings.jiraKeys.join(', '); $('#serr').textContent = '';
  $('#sweeks').innerHTML = [1, 2, 3, 4, 5, 6, 7, 8].map(n => `<option value="${n}">${n} week${n > 1 ? 's' : ''}</option>`).join('');
  $('#sweeks').value = String(settings.sprintWeeks);
  $('#advanced').open = Object.keys(draft.themeOverrides).length > 0;

  const render = () => {
    const theme = currentTheme(draft), mode = readableOn(theme.bg) === '#ffffff' ? 'dark' : 'light';
    applyTheme(theme);
    for (const b of document.querySelectorAll('#modes button')) b.setAttribute('aria-checked', String(b.dataset.mode === draft.themeMode));
    $('#presets').innerHTML = PRESETS.map(p => `<button type="button" role="radio" data-preset="${p.id}" aria-checked="${p.id === draft.themePreset}"><i style="background:${p[mode]}"></i>${esc(p.label)}</button>`).join('');
    $('#colors').innerHTML = THEME.map(t => `<label for="color-${t.key}">${esc(t.label)}${t.key in draft.themeOverrides ? ' •' : ''}</label><input type="color" id="color-${t.key}" data-key="${t.key}" value="${theme[t.key]}">`).join('');
  };
  $('#modes').onclick = e => { const b = e.target.closest('[data-mode]'); if (b) { draft.themeMode = b.dataset.mode; render(); } };
  $('#presets').onclick = e => {
    const b = e.target.closest('[data-preset]');
    if (!b) return;
    draft.themePreset = b.dataset.preset;
    delete draft.themeOverrides.accent; // picking a preset means "use this accent"
    render();
  };
  // Live preview while dragging; re-render only on commit so the picker isn't replaced mid-drag.
  $('#colors').oninput = e => { if (e.target.dataset.key) { draft.themeOverrides[e.target.dataset.key] = e.target.value; applyTheme(currentTheme(draft)); } };
  $('#colors').onchange = render;
  $('#resetcolors').onclick = () => { draft.themeOverrides = {}; render(); };
  render();

  let next = null;
  dg.querySelector('form').onsubmit = e => {
    if (e.submitter && e.submitter.value !== 'ok') return;
    const b = normalizeJiraBase($('#jbase').value), k = parseProjectKeys($('#jkeys').value);
    if (b.error || k.error) { e.preventDefault(); $('#serr').textContent = b.error || k.error; return; }
    next = { jiraBase: b.base, jiraKeys: k.keys, sprintWeeks: Number($('#sweeks').value), ...draft };
  };
  dg.returnValue = ''; dg.showModal(); $('#jbase').focus();
  await new Promise(res => (dg.onclose = res));
  if (dg.returnValue !== 'ok' || !next) { applyTheme(currentTheme()); return; }
  await saveSettings({ ...next, windowBg: currentTheme(next).bg });
  applyTheme(currentTheme());
  ui.setJira({ base: settings.jiraBase, keys: settings.jiraKeys });
  renderAutoEnd();
  $('#status').textContent = 'Settings saved';
}
$('#settings').onclick = onSettings;

/* archive context menu */
function confirmBox(message, okLabel) {
  const dg = $('#confirmdlg');
  $('#cmsg').textContent = message; $('#cok').textContent = okLabel;
  dg.returnValue = ''; dg.showModal();
  return new Promise(res => (dg.onclose = () => res(dg.returnValue === 'ok')));
}
async function renameBox(name) {
  const existing = await api.archives(), dg = $('#renamedlg'), input = $('#rname'), err = $('#rerr');
  input.value = archiveLabel(name); err.textContent = '';
  let result = null;
  dg.querySelector('form').onsubmit = e => {
    if (e.submitter && e.submitter.value !== 'ok') return;
    const r = renamedArchive(name, input.value, existing);
    if (r.error) { e.preventDefault(); err.textContent = r.error; input.focus(); return; }
    result = r.name;
  };
  dg.returnValue = ''; dg.showModal(); input.select();
  return new Promise(res => (dg.onclose = () => res(dg.returnValue === 'ok' ? result : null)));
}
function moveFolds(from, to) {
  try { const v = localStorage.getItem(foldKey(from)); localStorage.removeItem(foldKey(from)); if (to && v) localStorage.setItem(foldKey(to), v); } catch {}
}
async function archiveAction(action, name) {
  const f = 'archive/' + name, label = archiveDisplayName(name);
  if (action === 'delete') {
    if (!(await confirmBox(`Move the archived sprint “${label}” to the Trash?`, 'Move to Trash'))) return;
    await api.archiveTrash(name);
    moveFolds(f, null);
    if (file === f) await openFile('current.md');
    await refreshArchives();
    $('#status').textContent = `Moved ${label} to the Trash`;
  } else if (action === 'rename') {
    const next = await renameBox(name);
    if (!next || next === name) return;
    await api.archiveRename(name, next);
    moveFolds(f, 'archive/' + next);
    if (file === f) await openFile('archive/' + next);
    await refreshArchives();
    $('#status').textContent = `Renamed to ${archiveDisplayName(next)}`;
  } else if (action === 'restore') {
    const ok = await confirmBox(`Move the tasks from “${label}” back into the current sprint? They go on top of Today and This Week, and the archive is moved to the Trash.`, 'Make current sprint');
    if (!ok) return;
    if (timer) await save();
    const next = restoreSprint(await api.read('current.md'), await api.read(f));
    // Write the current sprint before trashing the archive, so a failure part-way can't lose tasks.
    await api.write('current.md', next); disk = next;
    await api.archiveTrash(name);
    moveFolds(f, null);
    await openFile('current.md');
    await refreshArchives();
    $('#status').textContent = `${label} is back in the current sprint`;
  }
}
$('#arch').addEventListener('contextmenu', async e => {
  const li = e.target.closest('li[data-f]');
  if (!li) return;
  e.preventDefault();
  li.classList.add('menu');
  try {
    const action = await api.archiveMenu();
    if (action) await archiveAction(action, li.dataset.f.replace('archive/', ''));
  } catch (err) {
    $('#status').textContent = `Couldn’t update the archive: ${err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`;
  } finally { li.classList.remove('menu'); }
});

/* navigation, search, misc */
document.addEventListener('click', e => { const t = e.target.closest('[data-f]'); if (t) openFile(t.dataset.f, t.classList.contains('hit') ? $('#q').value.trim() : ''); });
$('#folder').onclick = async () => { if (await api.changeFolder()) location.reload(); };
let st;
$('#q').addEventListener('input', e => {
  clearTimeout(st);
  const q = e.target.value.trim();
  if (q.length < 2) { if (searching) { searching = false; $('#title').textContent = curTitle; showEditor(); mark(); } return; }
  st = setTimeout(async () => {
    const hits = await api.search(q);
    searching = true; mark();
    $('#title').textContent = 'Search';
    $('#editor').hidden = true; $('#pv').hidden = false;
    $('#pv').innerHTML = `<h2>${hits.length} match${hits.length === 1 ? '' : 'es'} for “${esc(q)}”</h2>` +
      hits.map(h => `<div class="hit" data-f="${esc(h.file)}"><small>${esc(h.file === 'current.md' ? 'Current sprint' : h.file.replace('archive/', '').replace('.md', ''))}</small>${esc(h.text)}</div>`).join('');
  }, 200);
});
document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); $('#q').focus(); } });

/* ⌘N: jump to quick add on the current sprint from anywhere. Capture phase, so the editor never sees it. */
window.addEventListener('keydown', async e => {
  if (!e.metaKey || e.shiftKey || e.altKey || e.ctrlKey || e.key.toLowerCase() !== 'n') return;
  if (document.querySelector('dialog[open]')) return;
  e.preventDefault(); e.stopPropagation();
  if (!isCur() || searching) await openFile('current.md', '', { focusEditor: false });
  $('#add').focus(); $('#add').select();
}, true);
$('#add').addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.target.value = ''; ui.focus(); } });
window.addEventListener('focus', async () => {
  await checkAutoEnd();
  if (!isCur() || timer || searching) return;
  const t = await api.read('current.md');
  if (t !== disk) { disk = t; ui.set(t); }
});
window.addEventListener('beforeunload', () => { if (timer) save(); });
boot();
