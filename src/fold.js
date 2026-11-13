/*
 * Folding of `##` sections (Today, This Week, This Month, …). Folding is view-only: it hides the section's
 * blocks with decorations and never changes the document, so the saved markdown is unaffected.
 *
 * Folded sections are identified by heading text (lowercased), so they stay folded while the document is edited
 * or reloaded. The plugin state is the set of folded names; the app persists it.
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const foldKey = new PluginKey('fold');
const ITEM_LISTS = ['bulletList', 'orderedList', 'taskList'];

const isSectionHeading = node => node.type.name === 'heading' && node.attrs.level <= 2;
const sectionName = node => node.textContent.trim().toLowerCase();

/**
 * Top-level sections: each `#`/`##` heading with the position range of the blocks under it, up to the next one.
 * @returns {{name: string, level: number, headingPos: number, headingEnd: number, from: number, to: number, items: number}[]}
 */
export function sections(doc) {
  const out = [];
  doc.forEach((node, pos) => {
    if (isSectionHeading(node)) {
      out.push({ name: sectionName(node), level: node.attrs.level, headingPos: pos, headingEnd: pos + node.nodeSize, from: pos + node.nodeSize, to: pos + node.nodeSize, items: 0 });
    } else if (out.length) {
      const s = out[out.length - 1];
      s.to = pos + node.nodeSize;
      s.items += ITEM_LISTS.includes(node.type.name) ? node.childCount : 1;
    }
  });
  return out;
}

function decorations(state) {
  const folded = foldKey.getState(state), decos = [];
  for (const s of sections(state.doc)) {
    if (s.level !== 2) continue;
    const isFolded = folded.has(s.name);
    decos.push(Decoration.widget(s.headingPos + 1, view => toggleDOM(view, s.name, isFolded), {
      side: -1, ignoreSelection: true, key: `fold-${s.name}-${isFolded}`
    }));
    if (!isFolded) continue;
    decos.push(Decoration.node(s.headingPos, s.headingEnd, { class: 'is-folded' }));
    if (s.items) decos.push(Decoration.widget(s.headingEnd - 1, () => countDOM(s.items), { side: 1, ignoreSelection: true, key: `fold-count-${s.name}-${s.items}` }));
    state.doc.nodesBetween(s.from, s.to, (node, pos) => {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'fold-hidden' }));
      return false;
    });
  }
  return DecorationSet.create(state.doc, decos);
}

function toggleDOM(view, name, folded) {
  const b = document.createElement('button');
  b.className = 'fold-toggle'; b.contentEditable = 'false'; b.tabIndex = -1;
  b.setAttribute('aria-label', `${folded ? 'Expand' : 'Collapse'} section`);
  b.setAttribute('aria-expanded', String(!folded));
  b.textContent = folded ? '▸' : '▾';
  b.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); toggleFold(view, name); });
  return b;
}

function countDOM(n) {
  const s = document.createElement('span');
  s.className = 'fold-count'; s.contentEditable = 'false';
  s.textContent = `${n} hidden`;
  return s;
}

/** Fold or unfold the `##` section with this (case-insensitive) name. */
export function toggleFold(view, name, force) {
  const key = name.toLowerCase(), folded = new Set(foldKey.getState(view.state));
  const fold = force ?? !folded.has(key);
  if (fold) folded.add(key); else folded.delete(key);
  const tr = view.state.tr.setMeta(foldKey, folded);
  // Keep the cursor out of hidden content: park it at the end of the folded heading.
  const s = sections(view.state.doc).find(x => x.name === key);
  const { from } = view.state.selection;
  if (fold && s && from >= s.from && from <= s.to) tr.setSelection(TextSelection.create(tr.doc, s.headingEnd - 1));
  view.dispatch(tr);
}

export function setFolded(view, names) {
  view.dispatch(view.state.tr.setMeta(foldKey, new Set(names.map(n => n.toLowerCase()))));
}

export const getFolded = state => [...foldKey.getState(state)];

/** @param {{onChange: (names: string[]) => void}} options */
export const Fold = Extension.create({
  name: 'fold',
  addOptions: () => ({ onChange: () => {} }),
  addProseMirrorPlugins() {
    const { onChange } = this.options;
    return [new Plugin({
      key: foldKey,
      state: {
        init: () => new Set(),
        apply: (tr, value) => {
          const next = tr.getMeta(foldKey);
          if (!next) return value;
          onChange([...next]);
          return next;
        }
      },
      // Arrow keys can move the cursor into hidden blocks. Skip it past the folded section in the direction it
      // was travelling: below the section when moving down, onto the heading when moving up.
      appendTransaction(trs, oldState, state) {
        if (!trs.some(tr => tr.selectionSet) || trs.some(tr => tr.getMeta(foldKey))) return null;
        const folded = foldKey.getState(state), { from } = state.selection;
        const s = sections(state.doc).find(x => x.level === 2 && folded.has(x.name) && from >= x.from && from < x.to);
        if (!s) return null;
        const down = oldState.selection.from < s.from && s.to < state.doc.content.size;
        const target = down ? TextSelection.near(state.doc.resolve(s.to), 1) : TextSelection.create(state.doc, s.headingEnd - 1);
        return state.tr.setSelection(target);
      },
      props: { decorations }
    })];
  }
});
