/*
 * electron-builder afterPack hook: ad-hoc sign the packaged .app before the .dmg is made.
 *
 * The build sets `mac.identity: null`, so it never uses a developer certificate that happens to be in the
 * builder's keychain. Packaging still edits the bundle (Info.plist, icon, app code), which breaks the ad-hoc
 * signature Electron ships with, and Apple Silicon Macs won't run code with a broken signature. Re-signing
 * ad-hoc (`--sign -`) fixes that without needing an Apple Developer account.
 */
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
};
