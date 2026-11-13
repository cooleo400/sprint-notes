import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDefaults, DEFAULT_THEME, readableOn, themeVars, resolveTheme, contrast, PRESETS, BASES } from '../../src/settings.js';
import { addDays, defaultAutoEndDate, isAutoEndDue, nextAutoEndDate } from '../../src/schedule.js';

test('withDefaults fills everything in for a fresh install', () => {
  assert.deepEqual(withDefaults({ root: '/notes' }), {
    jiraBase: '', jiraKeys: [], sprintWeeks: 2, themeMode: 'dark', themePreset: 'blue', themeOverrides: {}, autoEnd: false, autoEndDate: ''
  });
});

test('the default theme matches the original palette', () => {
  assert.deepEqual(resolveTheme(withDefaults({}), false), { bg: '#1c1c1e', side: '#242426', hover: '#2e2e31', line: '#333336', text: '#e8e6e3', mute: '#8b8b90', accent: '#4aa3ff' });
  assert.deepEqual(DEFAULT_THEME, resolveTheme(withDefaults({}), true));
});

test('withDefaults keeps valid stored values and drops invalid ones', () => {
  const s = withDefaults({ sprintWeeks: 3, themeMode: 'neon', themePreset: 'teal', themeOverrides: { accent: '#FF0000', bg: 'red', bogus: '#000000' }, autoEnd: 'yes', autoEndDate: '2026-13-40' });
  assert.equal(s.sprintWeeks, 3);
  assert.equal(s.themeMode, 'dark');
  assert.equal(s.themePreset, 'blue');
  assert.deepEqual(s.themeOverrides, { accent: '#ff0000' });
  assert.equal(s.autoEnd, false);
  assert.equal(s.autoEndDate, '');
  assert.equal(withDefaults({ sprintWeeks: 0 }).sprintWeeks, 2);
  assert.equal(withDefaults({ sprintWeeks: 9 }).sprintWeeks, 2);
});

test('withDefaults turns an old full theme into overrides of the colours that were changed', () => {
  assert.deepEqual(withDefaults({ theme: { ...DEFAULT_THEME, accent: '#FFD60A' } }).themeOverrides, { accent: '#ffd60a' });
});

test('resolveTheme combines mode, preset and overrides', () => {
  assert.deepEqual(resolveTheme({ themeMode: 'light', themePreset: 'green', themeOverrides: {} }, true), { ...BASES.light, accent: '#12784f' });
  assert.equal(resolveTheme({ themeMode: 'dark', themePreset: 'green', themeOverrides: {} }, false).accent, '#3ccf91');
  assert.equal(resolveTheme({ themeMode: 'system', themePreset: 'blue', themeOverrides: {} }, true).bg, BASES.dark.bg);
  assert.equal(resolveTheme({ themeMode: 'system', themePreset: 'blue', themeOverrides: {} }, false).bg, BASES.light.bg);
  assert.equal(resolveTheme({ themeMode: 'light', themePreset: 'blue', themeOverrides: { side: '#123456' } }, false).side, '#123456');
});

test('every preset accent is readable as link text on its mode background', () => {
  for (const p of PRESETS) for (const mode of ['dark', 'light']) {
    assert.ok(contrast(p[mode], BASES[mode].bg) >= 4.5, `${p.id} ${mode}: ${contrast(p[mode], BASES[mode].bg).toFixed(2)}`);
  }
});

test('both base palettes keep body and secondary text readable', () => {
  for (const mode of ['dark', 'light']) {
    assert.ok(contrast(BASES[mode].text, BASES[mode].bg) >= 7, mode);
    assert.ok(contrast(BASES[mode].mute, BASES[mode].bg) >= 4.5, mode);
  }
});

test('readableOn picks dark text on light colours and white on dark ones', () => {
  assert.equal(readableOn('#4aa3ff'), '#06121f');
  assert.equal(readableOn('#ffd60a'), '#06121f');
  assert.equal(readableOn('#1d3a8a'), '#ffffff');
  assert.equal(readableOn('#000000'), '#ffffff');
});

test('themeVars maps colours to CSS variables and derives the accent text colour', () => {
  const v = themeVars({ ...DEFAULT_THEME, accent: '#1d3a8a' });
  assert.equal(v['--bg'], '#1c1c1e');
  assert.equal(v['--accent'], '#1d3a8a');
  assert.equal(v['--on-accent'], '#ffffff');
});

test('addDays crosses month, year and daylight-saving boundaries', () => {
  assert.equal(addDays('2026-01-25', 14), '2026-02-08');
  assert.equal(addDays('2026-12-25', 14), '2027-01-08');
  assert.equal(addDays('2026-03-01', 14), '2026-03-15');
  assert.equal(addDays('2026-10-25', 14), '2026-11-08');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
});

test('defaultAutoEndDate is one sprint from today', () => {
  assert.equal(defaultAutoEndDate('2026-11-12', 2), '2026-11-26');
  assert.equal(defaultAutoEndDate('2026-11-12', 1), '2026-11-19');
});

test('isAutoEndDue only fires when switched on and the day has come', () => {
  assert.equal(isAutoEndDue({ autoEnd: false, autoEndDate: '2026-11-01' }, '2026-11-12'), false);
  assert.equal(isAutoEndDue({ autoEnd: true, autoEndDate: '' }, '2026-11-12'), false);
  assert.equal(isAutoEndDue({ autoEnd: true, autoEndDate: '2026-11-13' }, '2026-11-12'), false);
  assert.equal(isAutoEndDue({ autoEnd: true, autoEndDate: '2026-11-12' }, '2026-11-12'), true);
  assert.equal(isAutoEndDue({ autoEnd: true, autoEndDate: '2026-10-01' }, '2026-11-12'), true);
});

test('nextAutoEndDate advances by sprint lengths past today', () => {
  assert.equal(nextAutoEndDate('2026-11-12', '2026-11-12', 2), '2026-11-26');
  assert.equal(nextAutoEndDate('2026-10-01', '2026-11-12', 2), '2026-11-26');
  assert.equal(nextAutoEndDate('2026-10-01', '2026-11-26', 2), '2026-12-10');
});
