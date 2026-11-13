const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const fs = require('fs'), path = require('path');
const cfg = () => path.join(app.getPath('userData'), 'config.json');
const TEMPLATE = '## Today\n\n## This Week\n\n## This Month\n';
let root = null;

function ensure() {
  fs.mkdirSync(path.join(root, 'archive'), { recursive: true });
  const f = path.join(root, 'current.md');
  if (!fs.existsSync(f)) fs.writeFileSync(f, TEMPLATE);
}
async function pick() {
  const r = await dialog.showOpenDialog({ title: 'Choose your notes folder', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled) return null;
  root = r.filePaths[0];
  fs.writeFileSync(cfg(), JSON.stringify({ ...readConfig(), root }));
  ensure();
  return root;
}
const safe = n => {
  const p = path.resolve(root, n);
  if (!p.startsWith(root + path.sep)) throw new Error('Path outside notes folder');
  return p;
};

ipcMain.handle('init', async () => {
  try { root = JSON.parse(fs.readFileSync(cfg())).root; } catch {}
  if (!root || !fs.existsSync(root)) await pick();
  if (root) ensure();
  return root;
});
ipcMain.handle('changeFolder', pick);
const readConfig = () => { try { return JSON.parse(fs.readFileSync(cfg(), 'utf8')); } catch { return {}; } };
const SETTING_KEYS = ['jiraBase', 'jiraKeys', 'sprintWeeks', 'theme', 'themeMode', 'themePreset', 'themeOverrides', 'windowBg', 'autoEnd', 'autoEndDate'];
const isHex = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
// The renderer validates settings for its error messages; these checks only stop malformed values reaching disk.
const VALID = {
  jiraBase: v => typeof v === 'string' && v.length <= 500 && (!v || /^https?:\/\//.test(v)),
  jiraKeys: v => Array.isArray(v) && v.every(k => typeof k === 'string' && /^[A-Z][A-Z0-9_]{1,9}$/.test(k)),
  sprintWeeks: v => Number.isInteger(v) && v >= 1 && v <= 8,
  theme: v => v && typeof v === 'object' && Object.values(v).every(isHex),
  themeMode: v => ['light', 'dark', 'system'].includes(v),
  themePreset: v => typeof v === 'string' && /^[a-z]{1,20}$/.test(v),
  themeOverrides: v => v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(isHex),
  windowBg: isHex,
  autoEnd: v => typeof v === 'boolean',
  autoEndDate: v => v === '' || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v))
};
ipcMain.handle('getSettings', () => {
  const c = readConfig();
  return Object.fromEntries(SETTING_KEYS.filter(k => k in c).map(k => [k, c[k]]));
});
ipcMain.handle('setSettings', (e, partial) => {
  for (const [k, v] of Object.entries(partial || {})) if (!VALID[k] || !VALID[k](v)) throw new Error(`Bad setting: ${k}`);
  fs.writeFileSync(cfg(), JSON.stringify({ ...readConfig(), ...partial }));
});
ipcMain.handle('open', (e, u) => { if (/^https?:\/\//i.test(u)) return shell.openExternal(u); });
ipcMain.handle('read', (e, n) => fs.readFileSync(safe(n), 'utf8'));
ipcMain.handle('write', (e, n, t) => fs.writeFileSync(safe(n), t));
ipcMain.handle('archives', () =>
  fs.readdirSync(path.join(root, 'archive')).filter(f => f.endsWith('.md')).sort().reverse());
ipcMain.handle('archiveWrite', (e, base, text) => {
  let name = `archive/${base}.md`, i = 2;
  while (fs.existsSync(safe(name))) name = `archive/${base}-${i++}.md`;
  fs.writeFileSync(safe(name), text);
  return name;
});
ipcMain.handle('saveExport', async (e, name, text) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showSaveDialog(win, {
    title: 'Export notes', defaultPath: path.join(app.getPath('documents'), path.basename(name)),
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, text);
  return r.filePath;
});
const archiveFile = name => {
  if (typeof name !== 'string' || !/^[^/\\:]+\.md$/.test(name) || name.startsWith('.')) throw new Error('Bad archive name');
  return safe('archive/' + name);
};
ipcMain.handle('archiveMenu', e => new Promise(resolve => {
  const pick = action => () => resolve(action);
  Menu.buildFromTemplate([
    { label: 'Make current sprint', click: pick('restore') },
    { label: 'Rename…', click: pick('rename') },
    { type: 'separator' },
    { label: 'Move to Trash', click: pick('delete') }
  ]).popup({
    window: BrowserWindow.fromWebContents(e.sender),
    // Runs when the menu closes, which on macOS can come just before the chosen item's click handler.
    callback: () => setTimeout(() => resolve(null), 100)
  });
}));
ipcMain.handle('archiveRename', (e, from, to) => {
  const src = archiveFile(from), dest = archiveFile(to);
  if (!fs.existsSync(src)) throw new Error('Archived sprint not found');
  if (fs.existsSync(dest) && from.toLowerCase() !== to.toLowerCase()) throw new Error('Name already in use');
  fs.renameSync(src, dest);
});
ipcMain.handle('archiveTrash', (e, name) => shell.trashItem(archiveFile(name)));
ipcMain.handle('search', (e, q) => {
  const needle = q.toLowerCase(), hits = [];
  const files = ['current.md', ...fs.readdirSync(path.join(root, 'archive')).filter(f => f.endsWith('.md')).sort().reverse().map(f => 'archive/' + f)];
  for (const f of files) {
    fs.readFileSync(safe(f), 'utf8').split('\n').forEach((line, i) => {
      if (hits.length < 300 && line.toLowerCase().includes(needle)) hits.push({ file: f, n: i + 1, text: line.trim() });
    });
  }
  return hits;
});

// The page saves its resolved background as windowBg, so a custom theme doesn't flash the default colour on launch.
function windowBackground() {
  const bg = readConfig().windowBg;
  return isHex(bg) ? bg : '#1c1c1e';
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200, height: 800, minWidth: 760, minHeight: 480,
    titleBarStyle: 'hiddenInset', backgroundColor: windowBackground(),
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  const ext = url => { if (/^https?:/.test(url)) shell.openExternal(url); };
  win.webContents.setWindowOpenHandler(({ url }) => { ext(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { e.preventDefault(); ext(url); });
  win.loadFile('index.html');
}
app.whenReady().then(() => {
  // Packaged builds get build/icon.icns from electron-builder; `npm start` would otherwise show Electron's icon.
  if (process.platform === 'darwin' && !app.isPackaged) app.dock.setIcon(path.join(__dirname, 'build', 'icon.png'));
  createWindow();
});
app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
