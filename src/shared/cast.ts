import themesJson from './movie-themes.json';

export type RoleSlot = 'lead' | 'security' | 'perf' | 'tests' | 'architect' | 'repro';

/** The base themes a film may borrow a neutral ramp from. */
export type NeutralsFrom = 'nocturne' | 'slate';

/**
 * The accessories a look may carry, drawn over the role silhouette in the order
 * the film lists them — `['bald', 'fedora']` puts the hat on the scalp.
 */
export const FEAT_IDS = [
  'bald', 'shades', 'specs', 'visor', 'fedora',
  'pointyhat', 'wildhair', 'goatee', 'beard', 'longhair',
] as const;
export type FeatId = (typeof FEAT_IDS)[number];

/** The film's single ramp: `--color-accent` as `base`, then the six steps. */
export interface PaletteAccent {
  300: string;
  400: string;
  500: string;
  600: string;
  700: string;
  900: string;
  base: string;
  /** The film's own word for the colour — what the swatch says. */
  name: string;
}

export interface FilmPalette {
  label: string;
  why: string;
  /**
   * Whose neutral ramp the film borrows. Cool films take Nocturne's blue-greys
   * and hot or monochrome ones Slate's zero-hue steps; guessing a ramp per film
   * is how a console ends up with hairlines nobody can see.
   */
  neutralsFrom: NeutralsFrom;
  term: string;
  bg: string;
  text: string;
  accent: PaletteAccent;
  /**
   * Declared per palette, never derived from the accent. A film whose accent IS
   * red still has to draw failure in something that survives beside it.
   */
  warn: string;
  warnEdge: string;
  warnTint: string;
  fail: string;
}

export interface MovieTheme {
  key: string;
  film: string;
  /** The in-world team name — a chip on the session picker, nowhere else. */
  team: string;
  note: string;
  roles: Partial<Record<RoleSlot, string>>;
  spare: string[];
  /** Absent on `off`, which is the absence of a theme rather than a colourless one. */
  palette?: FilmPalette;
  /**
   * Five pipe-joined hex per role slot — skin, skin shade, garment, garment
   * shade, hair — stored WITHOUT the leading `#`, which whatever paints them adds.
   */
  looks?: Partial<Record<RoleSlot, string>>;
  feats?: Partial<Record<RoleSlot, FeatId[]>>;
}

interface ThemesFile {
  themes: MovieTheme[];
}

/** Everything a view needs to cast an agent: the same shape `portraitFor` takes. */
export interface CastAgent {
  name: string;
  agentType: string;
  isLead: boolean;
}

export interface CastName {
  /** What the screen shows. */
  display: string;
  /** The join key — routing, URLs and API calls never see anything else. */
  real: string;
}

export interface Cast {
  theme: MovieTheme;
  asChar(name: string): CastName;
  /**
   * The role slot this agent was cast into, or null if it took a spare, kept its
   * own name, or was never cast at all. The looks follow THIS rather than the
   * portrait the sprite hashes, so an agent whose role the console could not
   * read keeps the default portrait instead of wearing a character's clothes.
   */
  slotOf(name: string): RoleSlot | null;
}

/** The picker's list, off first, in the database's order. */
export const MOVIE_THEMES: MovieTheme[] = (themesJson as ThemesFile).themes;

const OFF = MOVIE_THEMES[0];

export function themeFor(key: string | null | undefined): MovieTheme {
  return MOVIE_THEMES.find((theme) => theme.key === key) ?? OFF;
}

// The same table the portraits classify by, so the security character wears the
// hard hat. Deliberately NOT `portraitFor`: that one hashes the agent id when
// nothing matches, and a hashed character moves the moment an agent is renamed.
// An agent this table cannot place takes a spare instead.
const SLOT_PATTERNS: Array<[RegExp, RoleSlot]> = [
  [/security|review/, 'security'],
  [/perf/, 'perf'],
  [/test/, 'tests'],
  [/architect|plan/, 'architect'],
  [/repro|debug/, 'repro'],
];

function slotFor(agent: CastAgent): RoleSlot | null {
  if (agent.isLead) return 'lead';
  const type = agent.agentType.toLowerCase();
  for (const [pattern, slot] of SLOT_PATTERNS) {
    if (pattern.test(type)) return slot;
  }
  const name = agent.name.toLowerCase();
  for (const [pattern, slot] of SLOT_PATTERNS) {
    if (pattern.test(name)) return slot;
  }
  return null;
}

/**
 * The one mapping every view renders through. Names only: types, states, verbs
 * and metrics are readouts and keep their real values, and a name this cast was
 * not built with — a departed task owner, a run from another team — is its own
 * display name.
 */
export function buildCast(agents: readonly CastAgent[], themeKey: string | null | undefined): Cast {
  const theme = themeFor(themeKey);
  const characters = new Map<string, string>();
  const slots = new Map<string, RoleSlot>();
  const overflow: string[] = [];
  const taken = new Set<RoleSlot>();

  for (const agent of agents) {
    const slot = slotFor(agent);
    const character = slot && !taken.has(slot) ? theme.roles[slot] : undefined;
    if (slot && character) {
      taken.add(slot);
      characters.set(agent.name, character);
      slots.set(agent.name, slot);
    } else {
      overflow.push(agent.name);
    }
  }

  overflow.forEach((name, i) => {
    const spare = theme.spare[i];
    if (spare) characters.set(name, spare);
  });

  return {
    theme,
    asChar: (name) => ({ display: characters.get(name) ?? name, real: name }),
    slotOf: (name) => slots.get(name) ?? null,
  };
}
