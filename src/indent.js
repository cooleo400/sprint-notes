/*
 * Tab / Shift+Tab for any block, Notion-style: Tab nests the block under the list item above it, Shift+Tab moves
 * it back out. Markdown can only express indentation as nesting inside a list item, so a block with no list
 * above it has nothing to nest under and stays put.
 *
 * This extension owns Tab and Shift+Tab completely. The stock task-item and list-item keymaps each run
 * sink/liftListItem for their own item type, so with the cursor in a bullet nested inside a to-do the task-item
 * keymap would nest or un-nest the to-do above instead. Here sink/lift always target the innermost item.
 */
import { Extension } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { sinkListItem, liftListItem } from '@tiptap/pm/schema-list';

const ITEMS = ['listItem', 'taskItem'];
const LISTS = ['bulletList', 'orderedList', 'taskList'];
const SECTION = /^(today|this week|this month)$/i;

/**
 * The block Tab acts on: the list item when the cursor is in an item's first line, otherwise the textblock.
 * @returns {{depth: number, isItem: boolean} | null} depth of that node in the cursor's resolved position
 */
function unitAt($pos) {
  const d = $pos.depth;
  if (d < 1) return null;
  const parent = $pos.node(d - 1);
  if (ITEMS.includes(parent.type.name) && $pos.index(d - 1) === 0) return { depth: d - 1, isItem: true };
  if (parent.type.name === 'doc' || ITEMS.includes(parent.type.name)) return { depth: d, isItem: false };
  return null;
}

const isSectionHeading = n => n.type.name === 'heading' && n.attrs.level === 2 && SECTION.test(n.textContent.trim());

function placeCursor(tr, unitStart, offset) {
  return tr.setSelection(TextSelection.create(tr.doc, Math.min(unitStart + offset, tr.doc.content.size)));
}

export function indent(state, dispatch) {
  const $pos = state.selection.$from, unit = unitAt($pos);
  if (!unit) return false;
  const d = unit.depth, node = $pos.node(d);
  if (!unit.isItem && isSectionHeading(node)) return false;
  if (unit.isItem && $pos.index(d - 1) > 0) return sinkListItem(node.type)(state, dispatch);

  // For a first item we look past its list, for a block past the block itself.
  const anchorDepth = unit.isItem ? d - 1 : d;
  const index = $pos.index(anchorDepth - 1);
  if (index === 0) return false;
  const prev = $pos.node(anchorDepth - 1).child(index - 1);
  if (!LISTS.includes(prev.type.name)) return false;
  if (!dispatch) return true;

  const offset = $pos.pos - $pos.before(d);
  const prevEnd = $pos.before(anchorDepth);
  const target = prev.lastChild;
  const targetContentEnd = prevEnd - 2;
  const list = unit.isItem ? $pos.node(d - 1) : null;

  const tr = state.tr;
  if (unit.isItem && list.childCount === 1) tr.delete($pos.before(d - 1), $pos.after(d - 1));
  else tr.delete($pos.before(d), $pos.after(d));

  let unitStart;
  if (unit.isItem && target.lastChild.type === list.type) {
    // The item above already has a nested list of this kind: append to it.
    const at = targetContentEnd - 1;
    tr.insert(at, node);
    unitStart = at;
  } else if (unit.isItem) {
    tr.insert(targetContentEnd, list.type.create(list.attrs, node));
    unitStart = targetContentEnd + 1;
  } else {
    tr.insert(targetContentEnd, node);
    unitStart = targetContentEnd;
  }
  dispatch(placeCursor(tr, unitStart, offset).scrollIntoView());
  return true;
}

export function outdent(state, dispatch) {
  const $pos = state.selection.$from, unit = unitAt($pos);
  if (!unit) return false;
  const d = unit.depth, node = $pos.node(d);

  // The list item that currently contains the unit, and the list that item sits in.
  const itemDepth = unit.isItem ? d - 2 : d - 1;
  // A top-level item: lifting it out of its list turns it into plain text.
  if (unit.isItem && (itemDepth < 1 || !ITEMS.includes($pos.node(itemDepth).type.name))) return liftListItem(node.type)(state, dispatch);
  if (itemDepth < 1 || !ITEMS.includes($pos.node(itemDepth).type.name)) return false;
  const item = $pos.node(itemDepth);
  if (unit.isItem && item.type === node.type) return liftListItem(node.type)(state, dispatch);
  if (!dispatch) return true;

  const offset = $pos.pos - $pos.before(d);
  const tr = state.tr;
  let moved;
  if (unit.isItem) {
    const list = $pos.node(d - 1);
    moved = list.type.create(list.attrs, node);
    if (list.childCount === 1) tr.delete($pos.before(d - 1), $pos.after(d - 1));
    else tr.delete($pos.before(d), $pos.after(d));
  } else {
    // Take the block and everything after it in the item, so the remaining content keeps its order.
    const from = $pos.index(itemDepth), blocks = [];
    for (let i = from; i < item.childCount; i++) blocks.push(item.child(i));
    moved = Fragment.from(blocks);
    tr.delete($pos.before(d), $pos.end(itemDepth));
  }

  // Split the outer list after the containing item and put the moved content between the halves.
  const outer = tr.doc.resolve(tr.mapping.map($pos.before(itemDepth - 1)));
  const listNode = outer.nodeAfter, itemIndex = $pos.index(itemDepth - 1);
  const before = [], after = [];
  listNode.forEach((child, _, i) => (i <= itemIndex ? before : after).push(child));
  const parts = [listNode.type.create(listNode.attrs, before), ...(moved instanceof Fragment ? moved.content : [moved])];
  if (after.length) parts.push(listNode.type.create(listNode.attrs, after));
  tr.replaceWith(outer.pos, outer.pos + listNode.nodeSize, parts);

  const movedStart = outer.pos + parts[0].nodeSize + (unit.isItem ? 1 : 0);
  dispatch(placeCursor(tr, movedStart, offset).scrollIntoView());
  return true;
}

export const BlockIndent = Extension.create({
  name: 'blockIndent',
  priority: 200, // before the list item keymaps, which must never see Tab (see top of file)
  addKeyboardShortcuts() {
    // Always handled, so focus never leaves the editor and the stock keymaps never run.
    return {
      Tab: () => (indent(this.editor.state, this.editor.view.dispatch), true),
      'Shift-Tab': () => (outdent(this.editor.state, this.editor.view.dispatch), true)
    };
  }
});
