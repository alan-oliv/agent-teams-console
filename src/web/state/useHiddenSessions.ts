import { useCallback, useState } from 'react';
import type { TeamSummary } from '../../shared/domain';

/**
 * Sessions the operator has taken out of the picker with its `✕`.
 *
 * Hiding is a VIEW preference, not a state of the session: the team keeps
 * running, its `config.json` is untouched, and another browser still lists it.
 * That is the same rule `stop watching` follows, and for the same reason — the
 * console's only write into `~/.claude` is an inbox entry, so a picker row is
 * never something it may delete.
 *
 * The two are still different actions. `stop watching` stops following the
 * session on screen and deliberately KEEPS its row, marked `running · not
 * watching`, because paging back in is the picker's whole purpose. Hiding
 * removes the row, for the sessions that are only clutter.
 */
export const HIDDEN_KEY = 'console.hiddenSessions';

/**
 * Field by field rather than a cast, like `parseSettings`: a hand-edited or
 * older blob contributes what it can. Anything that is not an array of strings
 * hides nothing, which fails toward showing the operator too much rather than
 * too little — a picker that silently swallowed a live session would be far
 * worse than one that forgot a dismissal.
 */
export function parseHidden(raw: string | null): ReadonlySet<string> {
  if (!raw) return new Set();
  try {
    const stored: unknown = JSON.parse(raw);
    if (!Array.isArray(stored)) return new Set();
    return new Set(stored.filter((n): n is string => typeof n === 'string' && n.length > 0));
  } catch {
    return new Set();
  }
}

/**
 * A session with nothing in it to switch to. Claude Code writes a
 * `teams/<session>/config.json` for every window, holding just that window's
 * own lead, so on a busy machine these are most of the list.
 *
 * A workflow run is the exception, and the reason this is not just a member
 * count: a workflow's agents never enter `members[]`, so the session running
 * one has a roster of one and is somewhere to go all the same.
 */
export function isEmptySession(team: TeamSummary): boolean {
  return team.members < 2 && !team.workflow;
}

/**
 * Whether the picker is dropping this row — the rule the empty screens count
 * by, so their `N not shown` and the picker's cannot disagree.
 *
 * The reveal is deliberately not persisted, unlike hiding: it is a question the
 * operator asked once, not a preference they set.
 */
export function isNotShown(
  team: TeamSummary,
  hidden: ReadonlySet<string>,
  revealed: boolean,
): boolean {
  return hidden.has(team.name) || (!revealed && isEmptySession(team));
}

export interface HiddenSessions {
  hidden: ReadonlySet<string>;
  hide(name: string): void;
  /**
   * One `show them`, both kinds of dropped row: the ✕-hidden set is cleared and
   * lead-only sessions are revealed. Held here rather than inside the picker so
   * the empty screen can offer the same control — hiding the last row must
   * never be a one-way door, and the picker is not reachable from there.
   */
  showAll(): void;
  /** Whether lead-only sessions are being shown. Per-session, never stored. */
  revealed: boolean;
}

export function useHiddenSessions(): HiddenSessions {
  const [revealed, setRevealed] = useState(false);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => {
    // A store that THROWS on read is not hypothetical — a blocked origin and
    // Safari's private mode both do it, and this runs in a state initialiser,
    // so an escaping error takes the whole console down rather than one
    // preference. Same guard `useSettings` carries, and an existing test for it
    // is what caught this.
    try {
      if (typeof window === 'undefined') return new Set();
      return parseHidden(window.localStorage.getItem(HIDDEN_KEY));
    } catch {
      return new Set();
    }
  });

  const persist = useCallback((next: ReadonlySet<string>) => {
    setHidden(next);
    try {
      window.localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]));
    } catch {
      // A full or disabled store costs the operator the preference on the next
      // reload, and nothing else. Never let it break the picker.
    }
  }, []);

  const hide = useCallback(
    (name: string) => persist(new Set(hidden).add(name)),
    [hidden, persist],
  );

  const showAll = useCallback(() => {
    setRevealed(true);
    persist(new Set());
  }, [persist]);

  return { hidden, hide, showAll, revealed };
}
