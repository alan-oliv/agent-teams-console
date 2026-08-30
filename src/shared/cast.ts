import themesJson from './movie-themes.json';

export type RoleSlot = 'lead' | 'security' | 'perf' | 'tests' | 'architect' | 'repro';

export interface MovieTheme {
  key: string;
  film: string;
  /** The in-world team name — a chip on the session picker, nowhere else. */
  team: string;
  note: string;
  roles: Partial<Record<RoleSlot, string>>;
  spare: string[];
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
  const overflow: string[] = [];
  const taken = new Set<RoleSlot>();

  for (const agent of agents) {
    const slot = slotFor(agent);
    const character = slot && !taken.has(slot) ? theme.roles[slot] : undefined;
    if (slot && character) {
      taken.add(slot);
      characters.set(agent.name, character);
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
  };
}
