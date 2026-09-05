import { createContext, useContext } from 'react';

/**
 * Whether the console's current session is being dismissed, and the way to
 * change that — shared between App (which owns the state) and SessionPicker
 * (which shows and triggers it from the picker), without threading it through
 * StatusBar, which sits between them and has no use for the value.
 */
export interface WatchState {
  /** True once the operator has stopped watching the session on screen, in this tab. */
  dismissed: boolean;
  /** Opens the "stop watching this session?" confirmation. */
  requestStopWatching(): void;
  /** Resumes watching — picking the already-current session out of the picker. */
  watchAgain(): void;
  /**
   * Sessions taken out of the picker with its `✕`. Same browser-local rule as
   * `dismissed`, and distinct from it: dismissing KEEPS the row (marked
   * `running · not watching`) because paging back in is the picker's purpose,
   * while hiding removes it for the sessions that are only clutter.
   */
  hidden: ReadonlySet<string>;
  /** Takes one session out of the picker. Never touches `~/.claude`. */
  hideSession(name: string): void;
  /** Puts every hidden session back — the way out of an empty picker. */
  showHidden(): void;
}

// A safe no-op default so a component reading it outside a Provider — most
// SessionPicker tests, which render it standalone — behaves as "always watching"
// rather than crashing.
export const WatchContext = createContext<WatchState>({
  dismissed: false,
  requestStopWatching: () => {},
  watchAgain: () => {},
  hidden: new Set(),
  hideSession: () => {},
  showHidden: () => {},
});

export function useWatch(): WatchState {
  return useContext(WatchContext);
}
