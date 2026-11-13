/* Installs a jsdom window as Node globals. Import this before anything that loads TipTap or ProseMirror. */
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
const { window } = dom;
// ProseMirror maps "Mod" to ⌘ only when the platform looks like macOS, which is where this app runs.
Object.defineProperty(window.navigator, 'platform', { value: 'MacIntel' });
for (const key of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Text', 'Range', 'DOMParser',
  'MutationObserver', 'KeyboardEvent', 'MouseEvent', 'Event', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true });
}

// jsdom has no layout. ProseMirror measures positions when it scrolls the selection into view, so stub the
// measuring APIs with empty rectangles.
const rect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0 });
window.Range.prototype.getClientRects = () => [];
window.Range.prototype.getBoundingClientRect = rect;
window.Element.prototype.getClientRects = () => [];
window.Element.prototype.scrollIntoView = () => {};
window.document.elementFromPoint = () => null;
