/* Jira issue keys (e.g. RA-123): settings validation and matching. No DOM access, so they can be unit-tested. */

const KEY = '[A-Z][A-Z0-9_]{1,9}';

/**
 * Normalise the Jira address the user typed. Accepts the site (`https://acme.atlassian.net`) or any issue or
 * browse URL on it; an empty value turns the feature off.
 * @returns {{base: string} | {error: string}} base has no trailing slash, e.g. `https://acme.atlassian.net`
 */
export function normalizeJiraBase(input) {
  const raw = (input || '').trim();
  if (!raw) return { base: '' };
  let url;
  try { url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : 'https://' + raw); } catch { return { error: 'Enter a web address, e.g. https://yourcompany.atlassian.net' }; }
  if (!/^https?:$/.test(url.protocol) || !url.hostname.includes('.')) return { error: 'Enter a web address, e.g. https://yourcompany.atlassian.net' };
  const path = url.pathname.replace(/\/browse(\/.*)?$/, '').replace(/\/+$/, '');
  return { base: url.origin + path };
}

/**
 * Parse a comma- or space-separated list of project keys. Empty means any key.
 * @returns {{keys: string[]} | {error: string}}
 */
export function parseProjectKeys(input) {
  const keys = [...new Set((input || '').split(/[\s,]+/).filter(Boolean).map(k => k.toUpperCase()))];
  const bad = keys.find(k => !new RegExp(`^${KEY}$`).test(k));
  if (bad) return { error: `“${bad}” isn’t a Jira project key (letters and digits, starting with a letter).` };
  return { keys };
}

export const issueUrl = (base, key) => `${base}/browse/${key}`;

/**
 * Issue keys in `text`. With no project keys, any uppercase key matches (which also catches things like UTF-8).
 * @returns {{from: number, to: number, key: string}[]}
 */
export function findIssueKeys(text, keys = []) {
  const project = keys.length ? `(?:${keys.join('|')})` : KEY;
  const re = new RegExp(`(?<![\\w-])${project}-\\d+(?![\\w-])`, 'g');
  return [...text.matchAll(re)].map(m => ({ from: m.index, to: m.index + m[0].length, key: m[0] }));
}

/**
 * The issue key in a Jira issue URL, e.g. `RA-483` from `https://acme.atlassian.net/browse/RA-483?focusedId=1`.
 * Works for any Jira site, so pasted links shorten even before a Jira address is set.
 * @returns {string | null}
 */
export function issueKeyFromUrl(text) {
  const m = /^https?:\/\/[^\s/]+(?:\/[^\s?#]*)?\/browse\/([A-Z][A-Z0-9_]{1,9}-\d+)\/?(?:[?#]\S*)?$/.exec((text || '').trim());
  return m ? m[1] : null;
}

/**
 * Replace bare Jira issue URLs in markdown text with `[KEY](url)` links, as the editor does when one is pasted.
 * URLs already inside a markdown link or `<…>` autolink are left alone; trailing punctuation stays outside the link.
 */
export function shortenIssueUrls(text) {
  return text.replace(/https?:\/\/[^\s<>()]+/g, (url, at) => {
    if (/(\]\(|<)$/.test(text.slice(Math.max(0, at - 2), at))) return url;
    const trail = /[.,;:!?'"]+$/.exec(url)?.[0] || '';
    const bare = url.slice(0, url.length - trail.length), key = issueKeyFromUrl(bare);
    return key ? `[${key}](${bare})${trail}` : url;
  });
}
