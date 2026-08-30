import { createContext, useContext } from 'react';

/**
 * Whether the console's current session is being dismissed, and the way to
 * change that — shared between App (which owns the state) and TeamSelect
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
}

// A safe no-op default so a component reading it outside a Provider — most
// TeamSelect tests, which render it standalone — behaves as "always watching"
// rather than crashing.
export const WatchContext = createContext<WatchState>({
  dismissed: false,
  requestStopWatching: () => {},
  watchAgain: () => {},
});

export function useWatch(): WatchState {
  return useContext(WatchContext);
}
