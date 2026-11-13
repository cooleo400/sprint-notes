/*
 * Converting the selected list items between bullet, numbered and to-do. The stock toggleTaskList /
 * toggleBulletList / toggleOrderedList retype the whole list the cursor is in, so pressing Ctrl+T on one bullet
 * would turn every bullet in that list into a to-do. This converts only the selected items, splitting them out
 * of their list.
 */
import { TextSelection } from '@tiptap/pm/state';

const LIST_ITEM = { bulletList: 'listItem', orderedList: 'listItem', taskList: 'taskItem' };

/** Depth of the innermost list around the selection, or -1. */
function innermostListDepth($pos) {
  for (let d = $pos.depth; d > 0; d--) if (LIST_ITEM[$pos.node(d).type.name]) return d;
  return -1;
}

/**
 * Retype the selected items of the innermost list to `listName`.
 * @returns {boolean} false when the selection is not in a list of a different type (callers fall back to the stock toggle)
 */
export function convertListItems(listName) {
  return (state, dispatch) => {
    const { $from, $to, from, to } = state.selection;
    const depth = innermostListDepth($from);
    if (depth < 0) return false;
    const list = $from.node(depth);
    if (list.type.name === listName || $to.depth < depth || $to.node(depth) !== list) return false;
    if (!dispatch) return true;

    const schema = state.schema, newList = schema.nodes[listName], newItem = schema.nodes[LIST_ITEM[listName]];
    const first = $from.index(depth), last = $to.index(depth);
    const before = [], selected = [], after = [];
    list.forEach((item, _, i) => {
      if (i < first) before.push(item);
      else if (i > last) after.push(item);
      else selected.push(newItem.create(newItem === item.type ? item.attrs : null, item.content, item.marks));
    });
    const parts = [];
    if (before.length) parts.push(list.type.create(list.attrs, before));
    parts.push(newList.create(listName === 'orderedList' ? { start: 1 } : null, selected));
    if (after.length) parts.push(list.type.create(list.attrs, after));

    const start = $from.before(depth);
    const tr = state.tr.replaceWith(start, start + list.nodeSize, parts);
    // Items keep their size, so positions only move by the list boundary added in front of them.
    const shift = before.length ? 2 : 0;
    tr.setSelection(TextSelection.create(tr.doc, from + shift, to + shift));
    dispatch(tr.scrollIntoView());
    return true;
  };
}
