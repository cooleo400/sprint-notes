/*
 * Renders build/icon.svg to build/icon.png (1024px, used for the dock in development) and build/icon.icns
 * (used by electron-builder). Run with `npm run icon`; needs macOS for `sips` and `iconutil`.
 */
const { app, BrowserWindow } = require('electron');
const { execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');

const dir = path.join(__dirname, '..', 'build');
const SIZE = 1024;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE, height: SIZE, show: false, transparent: true, frame: false, useContentSize: true,
    webPreferences: { offscreen: true }
  });
  const svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
    `<html><body style="margin:0;background:transparent">${svg}</body></html>`));
  await new Promise(r => setTimeout(r, 300));
  const png = (await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE })).resize({ width: SIZE, height: SIZE, quality: 'best' });
  fs.writeFileSync(path.join(dir, 'icon.png'), png.toPNG());

  const iconset = fs.mkdtempSync(path.join(os.tmpdir(), 'icon-')) + '/icon.iconset';
  fs.mkdirSync(iconset);
  for (const s of [16, 32, 128, 256, 512]) {
    for (const [scale, suffix] of [[1, ''], [2, '@2x']]) {
      const px = String(s * scale);
      execFileSync('sips', ['-z', px, px, path.join(dir, 'icon.png'), '--out', path.join(iconset, `icon_${s}x${s}${suffix}.png`)], { stdio: 'ignore' });
    }
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(dir, 'icon.icns')]);
  console.log('Wrote build/icon.png and build/icon.icns');
  app.quit();
});
