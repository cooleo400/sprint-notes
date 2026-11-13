/* Rich-text (WYSIWYG) editor. The document is stored as markdown, but the user never sees the syntax:
   tiptap-markdown parses markdown into ProseMirror nodes on set() and serializes them back on get(). */
import { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { BulletList, TaskList, TaskItem } from '@tiptap/extension-list';
import taskLists from 'markdown-it-task-lists';
import Link from '@tiptap/extension-link';
import Text from '@tiptap/extension-text';
import Suggestion from '@tiptap/suggestion';
import { Markdown } from 'tiptap-markdown';
import { BlockIndent } from './indent.js';
import { convertListItems } from './lists.js';
import { JiraLinks, setJira } from './jira-links.js';
import { issueKeyFromUrl } from './jira.js';
import { Fold, toggleFold, setFolded, getFolded } from './fold.js';
import { defaultMarkdownSerializer } from 'prosemirror-markdown';

const http = u => /^https?:\/\//i.test(u || '');

/** Link mark that writes plain URLs back as bare text instead of prosemirror-markdown's `<https://…>` autolink form. */
const defLink = defaultMarkdownSerializer.marks.link;
const BareLink = Link.extend({
  addStorage() {
    return { markdown: { serialize: {
      open: (...a) => { const s = defLink.open(...a); return s === '<' ? '' : s; },
      close: (...a) => { const s = defLink.close(...a); return s === '>' ? '' : s; },
      mixable: true
    }, parse: {} } };
  }
});

/**
 * Markdown allows one list to mix `- [ ]` items and plain `- ` items, but the editor schema keeps task
 * items and bullet items in separate list nodes. On parse, split each mixed list into runs of one kind;
 * on serialize, write adjacent bullet/task lists with no blank line so the file reads as one list again.
 */
const LIST_TYPES = ['bulletList', 'taskList'];
function serializeList(state, node) {
  const prev = state.closed;
  if (prev && prev.type !== node.type && LIST_TYPES.includes(prev.type.name) && node.attrs.tight && prev.attrs.tight) state.flushClose(1);
  state.renderList(node, '  ', () => '- ');
}
function splitMixedLists(root) {
  for (const ul of [...root.querySelectorAll('ul.contains-task-list')]) {
    const runs = [];
    for (const li of [...ul.children]) {
      const task = li.classList.contains('task-list-item');
      if (!runs.length || runs[runs.length - 1].task !== task) runs.push({ task, items: [] });
      runs[runs.length - 1].items.push(li);
    }
    for (const run of runs) {
      const list = document.createElement('ul');
      if (run.task) list.setAttribute('data-type', 'taskList');
      run.items.forEach(li => list.appendChild(li));
      ul.before(list);
    }
    ul.remove();
  }
}
const MdBulletList = BulletList.extend({ addStorage: () => ({ markdown: { serialize: serializeList } }) });
const MdTaskList = TaskList.extend({
  addStorage: () => ({ markdown: { serialize: serializeList, parse: { setup: md => md.use(taskLists), updateDOM: splitMixedLists } } })
});
const TightTaskLists = Extension.create({
  name: 'tightTaskLists',
  addGlobalAttributes: () => [{
    types: ['taskList'],
    attributes: { tight: { default: true, parseHTML: el => el.getAttribute('data-tight') === 'true' || !el.querySelector('p') } }
  }]
});

/** Write text as typed. tiptap-markdown escapes `<` and `&` as HTML entities, but this app parses with HTML off. */
const RawText = Text.extend({ addStorage: () => ({ markdown: { serialize: (state, node) => state.text(node.text) } }) });

/* Commands shared by toolbar buttons, shortcuts and the "/" menu. */
function commands(editor, askLink) {
  const c = () => editor.chain().focus();
  const link = async () => {
    if (editor.isActive('link')) return c().extendMarkRange('link').unsetLink().run();
    const url = await askLink();
    if (!url) return editor.commands.focus();
    const href = http(url) ? url : 'https://' + url;
    if (editor.state.selection.empty) c().insertContent({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href } }] }).run();
    else c().setLink({ href }).run();
  };
  return {
    bold: () => c().toggleBold().run(), italic: () => c().toggleItalic().run(),
    strike: () => c().toggleStrike().run(), code: () => c().toggleCode().run(), link,
    h1: () => c().toggleHeading({ level: 1 }).run(), h2: () => c().toggleHeading({ level: 2 }).run(), h3: () => c().toggleHeading({ level: 3 }).run(),
    check: () => editor.commands.command(({ state, dispatch }) => convertListItems('taskList')(state, dispatch)) || c().toggleTaskList().run(),
    bullet: () => editor.commands.command(({ state, dispatch }) => convertListItems('bulletList')(state, dispatch)) || c().toggleBulletList().run(),
    number: () => editor.commands.command(({ state, dispatch }) => convertListItems('orderedList')(state, dispatch)) || c().toggleOrderedList().run(),
    quote: () => c().toggleBlockquote().run(), codeblock: () => c().toggleCodeBlock().run(), rule: () => c().setHorizontalRule().run(),
    toggle: () => {
      if (!editor.isActive('taskItem')) return c().toggleTaskList().run();
      return c().updateAttributes('taskItem', { checked: !editor.getAttributes('taskItem').checked }).run();
    },
    date: () => c().insertContent(new Date().toLocaleDateString('en-CA')).run()
  };
}

/* "/" menu */
const SLASH = [
  ['Heading 1', 'h1 title', 'h1'], ['Heading 2', 'h2', 'h2'], ['Heading 3', 'h3', 'h3'],
  ['To-do', 'todo task checkbox checklist', 'check'], ['Bullet list', 'ul bullet', 'bullet'], ['Numbered list', 'ol number', 'number'],
  ['Quote', 'blockquote', 'quote'], ['Code block', 'code fence', 'codeblock'], ['Divider', 'rule hr line divider', 'rule'],
  ['Link', 'url link', 'link'], ['Today’s date', 'date today', 'date']
];
function slashMenu(run) {
  let box, items = [], sel = 0, cmd;
  const draw = () => {
    box.innerHTML = '';
    if (!items.length) { box.hidden = true; return; }
    box.hidden = false;
    items.forEach((it, i) => {
      const li = document.createElement('li');
      li.textContent = it[0]; li.className = i === sel ? 'on' : '';
      li.addEventListener('mousedown', e => { e.preventDefault(); cmd(it); });
      box.appendChild(li);
    });
  };
  const place = r => { const b = r && r(); if (b) Object.assign(box.style, { left: b.left + 'px', top: b.bottom + 4 + 'px' }); };
  return Extension.create({
    name: 'slash',
    priority: 1100, // its Tab / Enter / arrow handling must run before the editor's own keymaps
    addProseMirrorPlugins() {
      return [Suggestion({
        editor: this.editor, char: '/',
        items: ({ query }) => SLASH.filter(([n, kw]) => (n + ' ' + kw).toLowerCase().includes(query.toLowerCase())),
        command: ({ editor, range, props }) => { editor.chain().focus().deleteRange(range).run(); run[props[2]](); },
        render: () => ({
          onStart: p => {
            box = document.createElement('ul'); box.className = 'slash'; document.body.appendChild(box);
            items = p.items; sel = 0; cmd = p.command; draw(); place(p.clientRect);
          },
          onUpdate: p => { items = p.items; sel = 0; cmd = p.command; draw(); place(p.clientRect); },
          onKeyDown: ({ event: e }) => {
            if (!items.length) return false;
            if (e.key === 'ArrowDown') { sel = (sel + 1) % items.length; draw(); return true; }
            if (e.key === 'ArrowUp') { sel = (sel + items.length - 1) % items.length; draw(); return true; }
            if (e.key === 'Enter' || e.key === 'Tab') { cmd(items[sel]); return true; }
            return false;
          },
          onExit: () => { box?.remove(); box = null; }
        })
      })];
    }
  });
}

export function createEditor({ parent, onChange, onOpen, askLink, onFoldChange = () => {} }) {
  let run, loading = false;
  const shortcuts = Extension.create({
    name: 'shortcuts',
    priority: 1000, // above StarterKit, whose hard-break extension also claims Mod-Enter
    addKeyboardShortcuts() {
      const k = name => () => (run[name](), true);
      return {
        // Mod is ⌘ on macOS; Ctrl variants are bound too so both work.
        'Mod-b': k('bold'), 'Ctrl-b': k('bold'), 'Mod-i': k('italic'), 'Ctrl-i': k('italic'),
        'Mod-t': k('check'), 'Ctrl-t': k('check'), 'Mod-Shift-x': k('strike'), 'Mod-e': k('code'),
        'Mod-l': k('link'), 'Mod-Enter': k('toggle'), 'Ctrl-Enter': k('toggle')
      };
    }
  });
  const editor = new Editor({
    element: parent,
    extensions: [
      StarterKit.configure({
        underline: false, // markdown has no underline
        link: false,
        bulletList: false,
        text: false
      }),
      BareLink.configure({ openOnClick: false, autolink: true, linkOnPaste: true, protocols: ['http', 'https'], isAllowedUri: http }),
      RawText, MdBulletList, MdTaskList, TaskItem.configure({ nested: true }), TightTaskLists,
      Markdown.configure({ html: false, linkify: true, tightLists: true, transformPastedText: true, transformCopiedText: true }),
      shortcuts, BlockIndent, JiraLinks, Fold.configure({ onChange: names => onFoldChange(names) }), slashMenu(new Proxy({}, { get: (_, n) => run[n] }))
    ],
    editorProps: {
      handleClickOn: () => false,
      // A pasted Jira issue URL becomes a link that reads just the key (RA-483). With text selected, the stock
      // link-on-paste behaviour (link the selection) still applies.
      handlePaste(view, event) {
        const url = event.clipboardData?.getData('text/plain')?.trim();
        const key = issueKeyFromUrl(url);
        if (!key || !view.state.selection.empty || view.state.selection.$from.parent.type.spec.code) return false;
        const link = view.state.schema.marks.link.create({ href: url });
        view.dispatch(view.state.tr.replaceSelectionWith(view.state.schema.text(key, [link]), false).removeStoredMark(link.type).scrollIntoView());
        return true;
      },
      handleDOMEvents: {
        click(view, e) {
          const a = e.target.closest && e.target.closest('a[href], .jira-link');
          if (!a) return false;
          e.preventDefault();
          const href = a.getAttribute('href') || a.getAttribute('data-href');
          if (http(href)) onOpen(href);
          return true;
        }
      }
    },
    onUpdate: () => { if (!loading) onChange(); }
  });
  run = commands(editor, askLink);
  return {
    editor, run: name => run[name](),
    get: () => { const md = editor.storage.markdown.getMarkdown(); return md ? md + '\n' : ''; },
    set(text, user) {
      // setContent dispatches synchronously, including fix-up transactions (e.g. the trailing empty paragraph)
      // that would otherwise count as edits and trigger a save of a file the user only opened.
      loading = !user;
      try { editor.commands.setContent(text, { emitUpdate: !!user }); } finally { loading = false; }
    },
    setReadOnly: b => editor.setEditable(!b, false),
    focus: () => editor.commands.focus('end'),
    toggleFold: (name, force) => toggleFold(editor.view, name, force),
    setFolded: names => setFolded(editor.view, names),
    folded: () => getFolded(editor.state),
    setJira: config => setJira(editor.view, config)
  };
}
