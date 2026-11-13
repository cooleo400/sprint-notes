/*
 * Shows Jira issue keys (RA-123) as clickable links. View-only: the file keeps the plain key, so changing the
 * Jira address later updates every link, archives included. Keys inside code or existing links are left alone.
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { findIssueKeys, issueUrl } from './jira.js';

export const jiraKey = new PluginKey('jiraLinks');

function build(doc, { base, keys }) {
  if (!base) return DecorationSet.empty;
  const decos = [];
  doc.descendants((node, pos, parent) => {
    if (parent.type.spec.code) return false;
    if (!node.isText || node.marks.some(m => m.type.name === 'link' || m.type.name === 'code')) return;
    for (const m of findIssueKeys(node.text, keys)) {
      decos.push(Decoration.inline(pos + m.from, pos + m.to, {
        class: 'jira-link', 'data-href': issueUrl(base, m.key), title: `Open ${m.key} in Jira`
      }));
    }
  });
  return DecorationSet.create(doc, decos);
}

export const JiraLinks = Extension.create({
  name: 'jiraLinks',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: jiraKey,
      state: {
        init: () => ({ config: { base: '', keys: [] }, decos: DecorationSet.empty }),
        apply(tr, value) {
          const config = tr.getMeta(jiraKey) || value.config;
          if (config !== value.config || tr.docChanged) return { config, decos: build(tr.doc, config) };
          return value;
        }
      },
      props: { decorations: state => jiraKey.getState(state).decos }
    })];
  }
});

/** @param {{base: string, keys: string[]}} config */
export const setJira = (view, config) => view.dispatch(view.state.tr.setMeta(jiraKey, config));
