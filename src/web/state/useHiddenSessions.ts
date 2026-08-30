import { useCallback, useState } from 'react';

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

export interface HiddenSessions {
  hidden: ReadonlySet<string>;
  hide(name: string): void;
  showAll(): void;
}

export function useHiddenSessions(): HiddenSessions {
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

  const showAll = useCallback(() => persist(new Set()), [persist]);

  return { hidden, hide, showAll };
}
