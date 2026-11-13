/* App settings: defaults, validation and theme helpers. No DOM access, so they can be unit-tested. */

/** The theme's colours, in the order the advanced pickers show them. */
export const THEME = [
  { key: 'bg', label: 'Background' },
  { key: 'side', label: 'Sidebar' },
  { key: 'hover', label: 'Buttons and highlights' },
  { key: 'line', label: 'Borders' },
  { key: 'text', label: 'Text' },
  { key: 'mute', label: 'Secondary text' },
  { key: 'accent', label: 'Accent' }
];

/** Base palettes for each colour mode. Dark is the app's original palette. */
export const BASES = {
  dark: { bg: '#1c1c1e', side: '#242426', hover: '#2e2e31', line: '#333336', text: '#e8e6e3', mute: '#8b8b90' },
  light: { bg: '#f7f7f8', side: '#ececee', hover: '#e2e2e6', line: '#d4d4d8', text: '#1c1c1e', mute: '#62626a' }
};

/** Accent presets, with a shade per mode so links keep at least 4.5:1 contrast on the background. */
export const PRESETS = [
  { id: 'blue', label: 'Blue', dark: '#4aa3ff', light: '#0a66e0' },
  { id: 'purple', label: 'Purple', dark: '#b18cff', light: '#6e3fe0' },
  { id: 'green', label: 'Green', dark: '#3ccf91', light: '#12784f' },
  { id: 'orange', label: 'Orange', dark: '#ff9f43', light: '#b04a00' },
  { id: 'pink', label: 'Pink', dark: '#ff6b9a', light: '#c4275e' }
];

export const MODES = ['light', 'dark', 'system'];
export const DEFAULT_THEME = { ...BASES.dark, accent: PRESETS[0].dark };

export const DEFAULTS = {
  jiraBase: '', jiraKeys: [], sprintWeeks: 2, themeMode: 'dark', themePreset: 'blue', themeOverrides: {}, autoEnd: false, autoEndDate: ''
};

export const isColor = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
export const isIsoDate = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
export const isSprintWeeks = n => Number.isInteger(n) && n >= 1 && n <= 8;

/** Only valid colours for known keys, lowercased. */
function cleanColors(obj) {
  const out = {};
  for (const t of THEME) if (isColor(obj?.[t.key])) out[t.key] = obj[t.key].toLowerCase();
  return out;
}

/** Stored settings merged over the defaults; unknown or invalid values fall back to the default. */
export function withDefaults(stored = {}) {
  let overrides = cleanColors(stored.themeOverrides);
  // Before colour modes existed, settings held a full `theme`. Keep any colours that differed from the default.
  if (!stored.themeOverrides && stored.theme) {
    overrides = Object.fromEntries(Object.entries(cleanColors(stored.theme)).filter(([k, v]) => v !== DEFAULT_THEME[k]));
  }
  return {
    jiraBase: typeof stored.jiraBase === 'string' ? stored.jiraBase : DEFAULTS.jiraBase,
    jiraKeys: Array.isArray(stored.jiraKeys) ? stored.jiraKeys : DEFAULTS.jiraKeys,
    sprintWeeks: isSprintWeeks(stored.sprintWeeks) ? stored.sprintWeeks : DEFAULTS.sprintWeeks,
    themeMode: MODES.includes(stored.themeMode) ? stored.themeMode : DEFAULTS.themeMode,
    themePreset: PRESETS.some(p => p.id === stored.themePreset) ? stored.themePreset : DEFAULTS.themePreset,
    themeOverrides: overrides,
    autoEnd: stored.autoEnd === true,
    autoEndDate: isIsoDate(stored.autoEndDate) ? stored.autoEndDate : ''
  };
}

/**
 * The colours to show: the mode's base palette, the preset's accent for that mode, then any advanced overrides.
 * @param {{themeMode: string, themePreset: string, themeOverrides: object}} settings
 * @param {boolean} systemDark whether macOS is in dark mode, used when themeMode is 'system'
 */
export function resolveTheme({ themeMode, themePreset, themeOverrides = {} }, systemDark) {
  const mode = themeMode === 'system' ? (systemDark ? 'dark' : 'light') : themeMode === 'light' ? 'light' : 'dark';
  const preset = PRESETS.find(p => p.id === themePreset) || PRESETS[0];
  return { ...BASES[mode], accent: preset[mode], ...cleanColors(themeOverrides) };
}

const luminance = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG contrast ratio between two colours, from 1 to 21. */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Text colour that stays readable on `hex`: near-black on light colours, white on dark ones.
 * Uses WCAG relative luminance, picking whichever of the two has the higher contrast.
 */
export const readableOn = hex => (contrast(hex, '#06121f') > contrast(hex, '#ffffff') ? '#06121f' : '#ffffff');

/** CSS custom properties for a theme, including derived ones. */
export function themeVars(theme) {
  return { ...Object.fromEntries(THEME.map(t => [`--${t.key}`, theme[t.key]])), '--on-accent': readableOn(theme.accent) };
}
