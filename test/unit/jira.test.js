import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeJiraBase, parseProjectKeys, issueUrl, findIssueKeys, issueKeyFromUrl, shortenIssueUrls } from '../../src/jira.js';

test('normalizeJiraBase accepts a site, a browse URL or an issue URL', () => {
  assert.deepEqual(normalizeJiraBase('https://acme.atlassian.net/'), { base: 'https://acme.atlassian.net' });
  assert.deepEqual(normalizeJiraBase('acme.atlassian.net'), { base: 'https://acme.atlassian.net' });
  assert.deepEqual(normalizeJiraBase(' https://acme.atlassian.net/browse/RA-12 '), { base: 'https://acme.atlassian.net' });
  assert.deepEqual(normalizeJiraBase('https://jira.acme.com/jira/browse/'), { base: 'https://jira.acme.com/jira' });
});

test('normalizeJiraBase treats blank as off and rejects non-web addresses', () => {
  assert.deepEqual(normalizeJiraBase('   '), { base: '' });
  assert.ok(normalizeJiraBase('javascript:alert(1)').error);
  assert.ok(normalizeJiraBase('not a url').error);
});

test('parseProjectKeys uppercases, dedupes and validates', () => {
  assert.deepEqual(parseProjectKeys('ra, core  RA'), { keys: ['RA', 'CORE'] });
  assert.deepEqual(parseProjectKeys(''), { keys: [] });
  assert.match(parseProjectKeys('RA, 9X').error, /9X/);
});

test('issueUrl builds a browse link', () => {
  assert.equal(issueUrl('https://acme.atlassian.net', 'RA-1'), 'https://acme.atlassian.net/browse/RA-1');
});

test('findIssueKeys finds whole keys only', () => {
  const text = 'Fix RA-12, see (CORE-7). Not xRA-1, RA-12x, RA-5-b or ra-3.';
  assert.deepEqual(findIssueKeys(text).map(m => m.key), ['RA-12', 'CORE-7']);
  assert.deepEqual(findIssueKeys('RA-12', [])[0], { from: 0, to: 5, key: 'RA-12' });
});

test('findIssueKeys limits matches to the configured projects', () => {
  assert.deepEqual(findIssueKeys('RA-1 CORE-2 UTF-8', ['RA']).map(m => m.key), ['RA-1']);
  assert.deepEqual(findIssueKeys('RA-1 UTF-8').map(m => m.key), ['RA-1', 'UTF-8']);
});

test('issueKeyFromUrl reads the key from Jira issue URLs on any site', () => {
  assert.equal(issueKeyFromUrl('https://acme.atlassian.net/browse/RA-483'), 'RA-483');
  assert.equal(issueKeyFromUrl('  https://acme.atlassian.net/browse/RA-483/  '), 'RA-483');
  assert.equal(issueKeyFromUrl('https://acme.atlassian.net/browse/RA-483?focusedCommentId=9#comment'), 'RA-483');
  assert.equal(issueKeyFromUrl('https://jira.acme.com/jira/browse/CORE-7'), 'CORE-7');
});

test('issueKeyFromUrl ignores other URLs and text', () => {
  assert.equal(issueKeyFromUrl('https://acme.atlassian.net/jira/software/projects/RA/boards/1'), null);
  assert.equal(issueKeyFromUrl('see https://acme.atlassian.net/browse/RA-483'), null);
  assert.equal(issueKeyFromUrl('javascript:x//browse/RA-1'), null);
  assert.equal(issueKeyFromUrl('RA-483'), null);
  assert.equal(issueKeyFromUrl(''), null);
});

test('shortenIssueUrls turns bare Jira issue URLs into key links', () => {
  assert.equal(shortenIssueUrls('https://animoto.atlassian.net/browse/RA-483'), '[RA-483](https://animoto.atlassian.net/browse/RA-483)');
  assert.equal(shortenIssueUrls('fix https://a.atlassian.net/browse/RA-1, then https://a.atlassian.net/browse/CORE-2.'),
    'fix [RA-1](https://a.atlassian.net/browse/RA-1), then [CORE-2](https://a.atlassian.net/browse/CORE-2).');
});

test('shortenIssueUrls leaves other URLs and existing links alone', () => {
  for (const text of ['see https://example.com/page', '[RA-1](https://a.atlassian.net/browse/RA-1)', '<https://a.atlassian.net/browse/RA-1>', 'RA-1 only']) {
    assert.equal(shortenIssueUrls(text), text);
  }
});
