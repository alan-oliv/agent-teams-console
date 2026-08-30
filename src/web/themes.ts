/**
 * The six themes, lifted from "Octo Session Console.dc.html" (const THEMES).
 *
 * The load-bearing rule, and the only reason a light theme is possible without
 * touching a component: **the neutral ramp is ordered BY USE, not by lightness.**
 * 900 is the quietest fill or hairline and 200 the strongest text. On a light
 * theme those values run dark-to-light — the opposite direction — so
 * `var(--color-neutral-700)` still means "a quiet label" either way and the
 * same markup reads correctly on paper and on carbon.
 */
export type ThemeId = 'nocturne' | 'organic' | 'ember' | 'frost' | 'slate' | 'phosphor';
export type AccentKey = 'a' | 'b' | 'c' | 'd';

/** `--color-neutral-200 … -900`, in that order. */
type Neutrals = readonly [string, string, string, string, string, string, string, string];
/** `--color-accent`, then `-300 -400 -500 -600 -700 -900` — the seven steps the console uses. */
type AccentSteps = readonly [string, string, string, string, string, string, string];

export interface Accent {
  /** The theme's own name for it — what the swatch's tooltip says. */
  name: string;
  steps: AccentSteps;
}

export interface Theme {
  label: string;
  /** Shown as the tile's tooltip: `dark · blue-grey`. */
  note: string;
  term: string;
  bg: string;
  text: string;
  /** Text on an accent fill — the ground, not the text colour, on every theme. */
  onAccent: string;
  n: Neutrals;
  warn: string;
  warnEdge: string;
  warnTint: string;
  fail: string;
  /**
   * The JSON token palette, per theme, all four roles. Picked at each theme's
   * own text lightness so a payload stays legible on paper as well as on
   * carbon.
   *
   * `jsonNumber` and `jsonNull` start at this theme's `warn` and `fail`, which
   * is where they used to be read from directly. They are their own entries
   * because those two are SEMANTIC tokens — "wants attention", "failed" — and a
   * number is neither. Borrowing them meant a theme could not retune its amber
   * against `--warn-tint` without retinting every number in every payload on
   * `--term`, a different ground. Keys and punctuation still map onto
   * accent-400 and neutral-600, which carry no such meaning.
   */
  jsonString: string;
  jsonNumber: string;
  jsonBoolean: string;
  jsonNull: string;
  accents: Record<AccentKey, Accent>;
}

export const THEMES: Record<ThemeId, Theme> = {
  nocturne: {
    label: 'Nocturne', note: 'dark · blue-grey',
    term: '#12141f', bg: '#161826', text: '#e9e9ed', onAccent: '#161826',
    n: ['#e2e3ea', '#c8cad6', '#b2b6ca', '#9397ab', '#75798c', '#595d6c', '#3f424d', '#292b31'],
    warn: '#d99e5c', warnEdge: '#6b4f2c', warnTint: '#2b2028', fail: '#c98d8d',
    jsonString: '#9ec9a8', jsonNumber: '#d99e5c',
    jsonBoolean: '#7fb4d9', jsonNull: '#c98d8d',
    accents: {
      a: { name: 'blurple', steps: ['#9184d9', '#d2cefd', '#b5abfc', '#968ae0', '#796cbf', '#5d5294', '#2b2741'] },
      b: { name: 'teal', steps: ['#6fb3ac', '#c3e6e1', '#9fd2cc', '#7ab8b1', '#5d9791', '#46716d', '#1f2f2e'] },
      c: { name: 'amber', steps: ['#c9a469', '#f0d8b4', '#dfbe8a', '#c9a469', '#a58551', '#7b643e', '#33291a'] },
      d: { name: 'rose', steps: ['#c88897', '#f1c9d4', '#dfa6b6', '#c88897', '#a66c7a', '#7d515c', '#331f25'] },
    },
  },
  organic: {
    label: 'Organic', note: 'light · paper & clay',
    term: '#f6f1e7', bg: '#ece5d7', text: '#2c2721', onAccent: '#f6f1e7',
    n: ['#221e19', '#2f2a23', '#3f382f', '#574d41', '#6f6353', '#8d7f6c', '#bdb09a', '#dcd3c1'],
    warn: '#a8702a', warnEdge: '#d8bd93', warnTint: '#f0e2cc', fail: '#a4504c',
    jsonString: '#4a6b3a', jsonNumber: '#a8702a',
    jsonBoolean: '#2f5c7a', jsonNull: '#a4504c',
    accents: {
      a: { name: 'moss', steps: ['#5f7a4a', '#33452a', '#3f5634', '#4e6a3e', '#5f7a4a', '#8ca379', '#dfe6d3'] },
      b: { name: 'lake', steps: ['#3f6f77', '#22434a', '#2b525a', '#35636c', '#3f6f77', '#7ba3aa', '#d5e4e6'] },
      c: { name: 'clay', steps: ['#a1622f', '#5a3417', '#6d411f', '#8a5326', '#a1622f', '#c99a6b', '#f0e0cd'] },
      d: { name: 'plum', steps: ['#7b4e73', '#43283f', '#54324e', '#67405f', '#7b4e73', '#a98aa3', '#ecdfea'] },
    },
  },
  ember: {
    label: 'Ember', note: 'dark · warm carbon',
    term: '#16120f', bg: '#1d1815', text: '#efe7e0', onAccent: '#1d1815',
    n: ['#efe7e0', '#ddd2c9', '#c7bab0', '#a89a8f', '#8a7c72', '#6a5e56', '#4a413b', '#2b2521'],
    warn: '#dda15e', warnEdge: '#6f4f2c', warnTint: '#2f2318', fail: '#d08a80',
    jsonString: '#a9c48f', jsonNumber: '#dda15e',
    jsonBoolean: '#8fb3c4', jsonNull: '#d08a80',
    accents: {
      a: { name: 'ember', steps: ['#d2794f', '#f5cbb4', '#eaab88', '#d2794f', '#a95f3e', '#7c452c', '#332016'] },
      b: { name: 'brass', steps: ['#c9a76a', '#f2dcb6', '#e2c48d', '#c9a76a', '#a2854f', '#77613a', '#2f2618'] },
      c: { name: 'olive', steps: ['#8fae7e', '#cfe0c4', '#b3caa4', '#8fae7e', '#6f8b60', '#516645', '#1f2a1c'] },
      d: { name: 'rosewood', steps: ['#b98a92', '#e8ccd0', '#d3aab1', '#b98a92', '#956c73', '#6d4f54', '#2a1e20'] },
    },
  },
  frost: {
    label: 'Frost', note: 'light · cool grey',
    term: '#f3f6f9', bg: '#e5ebf1', text: '#1c2530', onAccent: '#f3f6f9',
    n: ['#151c25', '#222c38', '#334050', '#4a5a6d', '#657687', '#8a99a8', '#b6c2cd', '#d5dde5'],
    warn: '#96631f', warnEdge: '#d9c194', warnTint: '#f2e6cd', fail: '#9e4a4a',
    jsonString: '#2f6b4a', jsonNumber: '#96631f',
    jsonBoolean: '#2a5885', jsonNull: '#9e4a4a',
    accents: {
      a: { name: 'indigo', steps: ['#4a6b96', '#22344b', '#2c4460', '#3a577a', '#4a6b96', '#8aa1bd', '#dbe4ef'] },
      b: { name: 'pine', steps: ['#2f7b78', '#153b3a', '#1d4d4b', '#26625f', '#2f7b78', '#79aead', '#d3e7e6'] },
      c: { name: 'violet', steps: ['#7a5a9e', '#3a2a4d', '#4a3663', '#5e447d', '#7a5a9e', '#ab94c4', '#e6dff0'] },
      d: { name: 'coral', steps: ['#a9564e', '#4f2723', '#63322d', '#7f4039', '#a9564e', '#c99490', '#f2dedb'] },
    },
  },
  slate: {
    label: 'Slate', note: 'dark · zero hue',
    term: '#131313', bg: '#1b1b1b', text: '#ededed', onAccent: '#131313',
    n: ['#ededed', '#dadada', '#c0c0c0', '#9e9e9e', '#7d7d7d', '#5e5e5e', '#414141', '#2a2a2a'],
    warn: '#c9a06a', warnEdge: '#63502f', warnTint: '#2b2419', fail: '#c58c8c',
    jsonString: '#a8c9ae', jsonNumber: '#c9a06a',
    jsonBoolean: '#a8bed4', jsonNull: '#c58c8c',
    accents: {
      a: { name: 'graphite', steps: ['#9a9a9a', '#e4e4e4', '#cccccc', '#adadad', '#8a8a8a', '#5f5f5f', '#2e2e2e'] },
      b: { name: 'steel', steps: ['#7fa8c9', '#cfe2f0', '#a8c8de', '#7fa8c9', '#5f83a1', '#455f75', '#1c2530'] },
      c: { name: 'sage', steps: ['#a3bd85', '#dceccb', '#bfd6a8', '#a3bd85', '#7f9666', '#5c6d4a', '#1f2619'] },
      d: { name: 'mauve', steps: ['#c093a6', '#eed6e0', '#d7b3c2', '#c093a6', '#9a7183', '#71525f', '#271d22'] },
    },
  },
  phosphor: {
    label: 'Phosphor', note: 'dark · CRT glow',
    term: '#080d09', bg: '#0e150f', text: '#d8f2d9', onAccent: '#080d09',
    n: ['#d8f2d9', '#bfe3c1', '#a2cda5', '#82b085', '#628a66', '#48664b', '#324734', '#1d2a1f'],
    warn: '#d9c85c', warnEdge: '#5e5726', warnTint: '#232213', fail: '#d97f7f',
    jsonString: '#8fe0a0', jsonNumber: '#d9c85c',
    jsonBoolean: '#7fd6d9', jsonNull: '#d97f7f',
    accents: {
      a: { name: 'green', steps: ['#5fd97f', '#c7f7d4', '#96eaad', '#5fd97f', '#3fa85c', '#2b7440', '#102518'] },
      b: { name: 'cyan', steps: ['#5fd0d9', '#c4f4f7', '#93e5ea', '#5fd0d9', '#3f9fa8', '#2b6f75', '#102425'] },
      c: { name: 'magenta', steps: ['#d95fbe', '#f7c4ec', '#ea93d8', '#d95fbe', '#a83f92', '#752b65', '#25101f'] },
      d: { name: 'amber', steps: ['#d9c85f', '#f7f0c4', '#eae293', '#d9c85f', '#a89b3f', '#756b2b', '#25220f'] },
    },
  },
};

export const THEME_IDS: readonly ThemeId[] = [
  'nocturne', 'organic', 'ember', 'frost', 'slate', 'phosphor',
];
export const ACCENT_KEYS: readonly AccentKey[] = ['a', 'b', 'c', 'd'];

export type Density = 'compact' | 'default' | 'roomy';
/** Transcript line gap, in px. */
export const DENSITY: Record<Density, number> = { compact: 5, default: 10, roomy: 16 };
export const DENSITY_IDS: readonly Density[] = ['compact', 'default', 'roomy'];

// The ramp steps the console actually consumes. Anything outside this list has
// no theme value, so a component reaching for one would resolve to nothing.
const NEUTRAL_STEPS = [200, 300, 400, 500, 600, 700, 800, 900] as const;
const ACCENT_STEPS = [300, 400, 500, 600, 700, 900] as const;

/**
 * Every colour the console body can resolve, as custom properties for the root.
 * Nothing may be painted from a literal below this line: a hex in a component
 * survives the theme switch and the light themes break silently around it.
 */
export function cssVarsFor(id: ThemeId, scheme: AccentKey): Record<string, string> {
  const theme = THEMES[id] ?? THEMES.nocturne;
  const accent = theme.accents[scheme] ?? theme.accents.a;
  const vars: Record<string, string> = {
    '--term': theme.term,
    '--color-bg': theme.bg,
    '--color-text': theme.text,
    '--on-accent': theme.onAccent,
    '--warn': theme.warn,
    '--warn-edge': theme.warnEdge,
    '--warn-tint': theme.warnTint,
    '--fail': theme.fail,
    '--json-string': theme.jsonString,
    '--json-number': theme.jsonNumber,
    '--json-boolean': theme.jsonBoolean,
    '--json-null': theme.jsonNull,
    '--color-accent': accent.steps[0],
  };
  NEUTRAL_STEPS.forEach((step, i) => {
    vars[`--color-neutral-${step}`] = theme.n[i];
  });
  ACCENT_STEPS.forEach((step, i) => {
    vars[`--color-accent-${step}`] = accent.steps[i + 1];
  });
  return vars;
}
